#!/usr/bin/env python3
"""Exercise the configured Gutters HTTPS API with two synthetic records.

Run on Ubuntu as root after the public HTTPS route and reviewed service are live:
  sudo python3 server/deploy/public_acceptance.py create
  sudo systemctl restart gutters.service
  sudo python3 server/deploy/public_acceptance.py verify
  # Independently verify the customer workflow from outside the tailnet first.
  sudo python3 server/deploy/public_acceptance.py cleanup

Use `resume` after an uncertain create run. `create` also resumes an existing run.
All six mutation identities are saved before the first request. The owner key is
read from the protected environment file, never printed or stored in this state.
State stays root-owned and mode 0600 at /var/lib/gutters/public-acceptance-access.json.
Cleanup revokes only the two saved, identity-checked synthetic capabilities. It
retains their labeled records and this private evidence; repeat cleanup after an
uncertain acknowledgement. No delete, live-database restore, external notification
or route mutation occurs. Running on Ubuntu or a tailnet client does not prove
that customers outside the tailnet can reach the endpoint or use the browser flow.
"""
import argparse
import base64
import datetime
import hashlib
import json
import os
import pathlib
import re
import secrets
import stat
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid


ENV_PATH = pathlib.Path('/etc/gutters/gutters.env')
STATE_PATH = pathlib.Path('/var/lib/gutters/public-acceptance-access.json')
WEBSITE_ORIGIN = 'https://wisdomscreen.pro'
CAPABILITY = re.compile(r'^[A-Za-z0-9_-]{43}$')
UUID = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
FIELDS = ['name', 'phone', 'details', 'address', 'homeSize', 'stories', 'gutterLength']
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nv1kAAAAASUVORK5CYII=')


class AcceptanceFailure(Exception):
    pass


def require(condition, code):
    if not condition:
        raise AcceptanceFailure(code)


def digest(value):
    if not isinstance(value, bytes):
        value = json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
    return hashlib.sha256(value).hexdigest()


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')


def private_file(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and not path.is_symlink(), 'private_file_not_regular')
    require(info.st_uid == 0 and info.st_mode & 0o077 == 0, 'private_file_permissions')


def canonical_https(value):
    parsed = urllib.parse.urlsplit(value)
    require(parsed.scheme == 'https' and parsed.hostname and not parsed.path
            and not parsed.query and not parsed.fragment and not parsed.username
            and not parsed.password, 'public_https_origin_required')
    # Forces validation of malformed ports while keeping credentials out of diagnostics.
    require(parsed.port is None or 1 <= parsed.port <= 65535, 'invalid_public_port')
    require(value == 'https://' + parsed.netloc, 'canonical_public_origin_required')
    return value


def read_environment():
    private_file(ENV_PATH)
    values = {}
    for line in ENV_PATH.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        value = value.strip()
        if len(value) > 1 and value[0] == value[-1] and value[0] in '\"\'':
            value = value[1:-1]
        values[key.strip()] = value
    owner_key = values.get('GUTTERS_OWNER_TOKEN', '')
    require(bool(CAPABILITY.fullmatch(owner_key)), 'owner_key_unavailable')
    origin = canonical_https(values.get('GUTTERS_PUBLIC_ORIGIN', ''))
    allowed = [value.strip() for value in values.get('GUTTERS_ALLOWED_ORIGINS', '').split(',')]
    require(WEBSITE_ORIGIN in allowed or origin == WEBSITE_ORIGIN, 'website_origin_not_configured')
    return origin, owner_key


def service_identity():
    result = subprocess.run(['systemctl', 'show', 'gutters.service', '--property=ActiveState',
                             '--property=MainPID', '--property=ExecMainStartTimestampMonotonic'],
                            capture_output=True, text=True, timeout=10)
    require(result.returncode == 0, 'service_identity_unavailable')
    values = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    require(values.get('ActiveState') == 'active' and values.get('MainPID', '0').isdigit()
            and int(values['MainPID']) > 0 and values.get('ExecMainStartTimestampMonotonic', '0').isdigit()
            and int(values['ExecMainStartTimestampMonotonic']) > 0, 'gutters_service_not_active')
    return {'pid': values['MainPID'], 'started': values['ExecMainStartTimestampMonotonic']}


def save_state(state, *, exclusive=False):
    require(STATE_PATH.parent.is_dir() and not STATE_PATH.parent.is_symlink(), 'private_state_directory_unavailable')
    data = (json.dumps(state, indent=2) + '\n').encode()
    if exclusive:
        descriptor = os.open(STATE_PATH, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    else:
        private_file(STATE_PATH)
        descriptor, name = tempfile.mkstemp(prefix='.public-acceptance-', dir=STATE_PATH.parent)
        try:
            os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, 'wb') as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(name, STATE_PATH)
        finally:
            if os.path.exists(name):
                os.unlink(name)
    directory = os.open(STATE_PATH.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    private_file(STATE_PATH)


def synthetic_intake(label):
    require(label in ('A', 'B'), 'invalid_synthetic_label')
    return {'name': 'SYNTHETIC PUBLIC ACCEPTANCE ' + label,
            'phone': '2395550101' if label == 'A' else '2395550102',
            'details': 'SYNTHETIC deployment verification only. Not a customer job. No contact or work requested.'}


def new_payload(label):
    intake = synthetic_intake(label)
    return {'schemaVersion': 2, 'conversationId': str(uuid.uuid4()), 'operationId': str(uuid.uuid4()),
            'accessToken': secrets.token_urlsafe(32), 'intake': intake,
            'answers': [{'field': field, 'state': 'provided', 'answer': intake[field]} if field in intake
                        else {'field': field, 'state': 'later'} for field in FIELDS]}


def load_state(origin, mode):
    if not STATE_PATH.exists():
        require(mode == 'create', 'acceptance_state_missing_use_create')
        state = {'version': 1, 'createdAt': now(), 'origin': origin, 'websiteOrigin': WEBSITE_ORIGIN,
                 'records': {label: new_payload(label) for label in ('A', 'B')},
                 'photo': {'operationId': str(uuid.uuid4()), 'filename': 'synthetic-public-acceptance.png',
                           'mime': 'image/png', 'sha256': digest(PNG)},
                 'draft': {'operationId': str(uuid.uuid4()), 'scope': 'SYNTHETIC acceptance scope. No customer work.',
                           'amount': '123.45', 'notes': 'SYNTHETIC manual estimate for deployment verification only.'},
                 'publish': {'operationId': str(uuid.uuid4())},
                 'reply': {'operationId': str(uuid.uuid4()), 'body': 'SYNTHETIC customer reply after reading the test estimate.'},
                 'crossCustomerReply': {'operationId': str(uuid.uuid4()), 'body': 'SYNTHETIC isolation check: this write must be denied.'},
                 'receipts': {}, 'checks': {}}
        save_state(state, exclusive=True)
    private_file(STATE_PATH)
    state = json.loads(STATE_PATH.read_text(encoding='utf-8'))
    require(state.get('version') == 1 and state.get('origin') == origin
            and state.get('websiteOrigin') == WEBSITE_ORIGIN, 'acceptance_state_origin_mismatch')
    require(set(state.get('records', {})) == {'A', 'B'}, 'invalid_synthetic_record_set')
    for label in ('A', 'B'):
        payload = state.get('records', {}).get(label, {})
        require(bool(UUID.fullmatch(payload.get('conversationId', '')))
                and bool(UUID.fullmatch(payload.get('operationId', '')))
                and bool(CAPABILITY.fullmatch(payload.get('accessToken', '')))
                and payload.get('intake') == synthetic_intake(label),
                'invalid_synthetic_identity')
    require(len({record['conversationId'] for record in state['records'].values()}) == 2
            and len({record['accessToken'] for record in state['records'].values()}) == 2,
            'synthetic_identities_not_distinct')
    for key in ('photo', 'draft', 'publish', 'reply', 'crossCustomerReply'):
        require(bool(UUID.fullmatch(state.get(key, {}).get('operationId', ''))), 'invalid_saved_operation')
    require(state['photo']['sha256'] == digest(PNG), 'synthetic_photo_changed')
    if mode == 'verify':
        require(state.get('completed') and state.get('baseline') and state.get('serviceAtCompleted'),
                'acceptance_not_complete_use_resume')
    require(mode == 'cleanup' or not state.get('cleanup'), 'cleanup_started_use_cleanup_only')
    return state


def reachability_scope():
    return {'verification_scope': 'Configured HTTPS API checks from the executing host only.',
            'independent_public_reachability_verified': False,
            'requires_independent_non_tailnet_verification': True}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, stream, code, message, headers, new_url):
        return None


class PublicChecks:
    def __init__(self, origin, owner_key, state):
        self.origin, self.owner_key, self.state = origin, owner_key, state
        self.opener = urllib.request.build_opener(NoRedirect)
        self.stage = 'starting'

    def request(self, path, *, method='GET', body=None, token=None, owner=False,
                binary=False, expected=(200,), origin=None, headers=None):
        require(path.startswith('/') and not path.startswith('//') and '#' not in path,
                'invalid_acceptance_path')
        source_origin = origin or (self.origin if owner else WEBSITE_ORIGIN)
        request_headers = {'Origin': source_origin, 'User-Agent': 'WisdomScreen-Synthetic-Acceptance/1.0',
                           'Cache-Control': 'no-store'}
        if owner or token:
            request_headers['Authorization'] = 'Bearer ' + (self.owner_key if owner else token)
        data = None
        if body is not None:
            if isinstance(body, bytes):
                data = body
            else:
                data = json.dumps(body, separators=(',', ':')).encode()
                request_headers['Content-Type'] = 'application/json'
        request_headers.update(headers or {})
        request = urllib.request.Request(self.origin + path, data=data, method=method, headers=request_headers)
        try:
            response = self.opener.open(request, timeout=85)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            status = response.status
            content = response.read(6 * 1024 * 1024 + 1)
            response_headers = response.headers
        require(len(content) <= 6 * 1024 * 1024, 'response_too_large')
        require(status in expected, 'unexpected_http_' + str(status))
        require(response_headers.get('Cache-Control') == 'no-store', 'private_response_cacheable')
        if source_origin in (self.origin, WEBSITE_ORIGIN):
            require(response_headers.get('Access-Control-Allow-Origin') == source_origin, 'cors_origin_mismatch')
        if status == 204:
            return None, response_headers
        if binary:
            require(response_headers.get('X-Content-Type-Options') == 'nosniff', 'photo_sniffing_allowed')
            return content, response_headers
        value = json.loads(content)
        encoded = json.dumps(value)
        require(self.owner_key not in encoded and all(record['accessToken'] not in encoded for record in self.state['records'].values()),
                'capability_disclosed_in_response')
        if 200 <= status < 300:
            require(value.get('ok') is True, 'successful_response_not_confirmed')
        return value, response_headers

    def payload(self, label='A'):
        return self.state['records'][label]

    def route(self, label='A'):
        return '/conversations/' + self.payload(label)['conversationId']

    def customer(self, label='A'):
        return self.request(self.route(label), token=self.payload(label)['accessToken'])[0]

    def owner(self, label='A'):
        return self.request('/owner/api' + self.route(label), owner=True)[0]

    def receipt(self, label, result, operation_id, replay=False):
        receipt = result.get('receipt', {})
        require(receipt.get('operationId') == operation_id, 'operation_receipt_mismatch')
        if replay:
            require(result.get('duplicate') is True, 'retry_not_reported_duplicate')
        existing = self.state['receipts'].get(label)
        require(existing is None or existing == receipt, 'retry_receipt_changed')
        self.state['receipts'][label] = receipt
        save_state(self.state)

    def create_records(self, replay=False):
        self.stage = 'request_creation_or_exact_retry'
        for label in ('A', 'B'):
            payload = self.payload(label)
            result, _ = self.request('/conversations', method='POST', body=payload, expected=(201,))
            require(result.get('conversation', {}).get('id') == payload['conversationId'], 'created_request_mismatch')
            self.receipt('create' + label, result, payload['operationId'], replay)

    def photo(self, replay=False):
        self.stage = 'private_photo_or_exact_retry'
        metadata = self.state['photo']
        boundary = 'WisdomScreenSynthetic' + metadata['operationId'].replace('-', '')
        body = ('--' + boundary + '\r\nContent-Disposition: form-data; name="operationId"\r\n\r\n'
                + metadata['operationId'] + '\r\n--' + boundary
                + '\r\nContent-Disposition: form-data; name="file"; filename="' + metadata['filename']
                + '"\r\nContent-Type: image/png\r\n\r\n').encode() + PNG + ('\r\n--' + boundary + '--\r\n').encode()
        result, _ = self.request(self.route() + '/photos', method='POST', body=body,
                                 token=self.payload()['accessToken'], expected=(201,),
                                 headers={'Content-Type': 'multipart/form-data; boundary=' + boundary})
        photo_id = result.get('photo', {}).get('id')
        require(bool(UUID.fullmatch(photo_id or '')) and result.get('receipt', {}).get('photoId') == photo_id,
                'photo_receipt_mismatch')
        require(self.state.get('photoId', photo_id) == photo_id, 'photo_identity_changed')
        self.state['photoId'] = photo_id
        self.receipt('photo', result, metadata['operationId'], replay)

    def draft(self, replay=False):
        self.stage = 'manual_draft_or_exact_retry'
        result, _ = self.request('/owner/api' + self.route() + '/estimates', method='POST',
                                 body=self.state['draft'], owner=True, expected=(201,))
        estimate_id = result.get('estimate', {}).get('id')
        require(bool(UUID.fullmatch(estimate_id or '')) and result.get('receipt', {}).get('estimateId') == estimate_id,
                'estimate_receipt_mismatch')
        require(self.state.get('estimateId', estimate_id) == estimate_id, 'estimate_identity_changed')
        self.state['estimateId'] = estimate_id
        self.receipt('draft', result, self.state['draft']['operationId'], replay)
        owner = self.owner()
        matches = [estimate for estimate in owner.get('estimates', []) if estimate['id'] == estimate_id]
        require(len(matches) == 1, 'owner_draft_not_read_back')
        self.check_estimate(matches[0])
        if not self.state['checks'].get('draft_private'):
            customer = self.customer()
            require(customer.get('estimate') is None and 'estimates' not in customer
                    and self.state['draft']['scope'] not in json.dumps(customer), 'draft_visible_to_customer')
            require(matches[0].get('status') == 'draft', 'initial_draft_not_private')
            self.state['checks']['draft_private'] = True
            save_state(self.state)

    def check_estimate(self, estimate):
        require(all(estimate.get(field) == self.state['draft'][field] for field in ('scope', 'amount', 'notes'))
                and estimate.get('currency') == 'USD', 'manual_estimate_content_changed')

    def publish(self, replay=False):
        self.stage = 'explicit_publication_or_exact_retry'
        require(self.state['checks'].get('draft_private'), 'draft_privacy_not_verified')
        result, _ = self.request('/owner/api' + self.route() + '/estimates/' + self.state['estimateId'] + '/publish',
                                 method='POST', body=self.state['publish'], owner=True)
        self.receipt('publish', result, self.state['publish']['operationId'], replay)
        customer = self.customer()
        estimate = customer.get('estimate') or {}
        require(estimate.get('id') == self.state['estimateId'] and estimate.get('status') == 'published',
                'customer_publication_not_read_back')
        self.check_estimate(estimate)

    def reply(self, replay=False):
        self.stage = 'customer_reply_or_exact_retry'
        result, _ = self.request(self.route() + '/messages', method='POST', body=self.state['reply'],
                                 token=self.payload()['accessToken'], expected=(201,))
        self.receipt('reply', result, self.state['reply']['operationId'], replay)

    def security_checks(self):
        self.stage = 'public_readiness_cors_and_isolation'
        health, _ = self.request('/healthz')
        require(health.get('service') == 'gutters-messaging' and health.get('storage') == 'sqlite', 'wrong_public_service')
        _, headers = self.request(self.route() + '/photos', method='OPTIONS', expected=(204,),
                                  headers={'Access-Control-Request-Method': 'POST',
                                           'Access-Control-Request-Headers': 'Authorization, Content-Type'})
        require({'authorization', 'content-type'} <= {value.strip().lower() for value in headers.get('Access-Control-Allow-Headers', '').split(',')},
                'cors_authorization_headers_missing')
        require({'GET', 'POST', 'OPTIONS'} <= {value.strip() for value in headers.get('Access-Control-Allow-Methods', '').split(',')},
                'cors_methods_missing')
        photo_path = self.route() + '/photos/' + self.state['photoId']
        for route, token in ((photo_path, None), (photo_path, self.payload('B')['accessToken']),
                             (self.route('B') + '/photos/' + self.state['photoId'], self.payload('B')['accessToken'])):
            result, _ = self.request(route, token=token, expected=(404,))
            require(result.get('ok') is False, 'unauthorized_photo_not_rejected')
        result, _ = self.request(self.route() + '/messages', method='POST', body=self.state['crossCustomerReply'],
                                 token=self.payload('B')['accessToken'], expected=(404,))
        require(result.get('ok') is False, 'cross_customer_message_not_rejected')
        self.request('/owner/api/conversations', expected=(401,), origin=self.origin)
        _, hostile_headers = self.request('/conversations', method='OPTIONS', origin='https://unrelated.example.invalid', expected=(403,))
        require(hostile_headers.get('Access-Control-Allow-Origin') is None, 'unrelated_origin_allowed')
        self.state['checks'].update(cors=True, private_no_store=True, owner_auth=True,
                                    cross_customer_photos=True, cross_customer_messages=True)
        save_state(self.state)

    def snapshot(self):
        self.stage = 'durable_private_readback'
        customer_a, customer_b = self.customer('A'), self.customer('B')
        owner_a, owner_b = self.owner('A'), self.owner('B')
        require(len(customer_a.get('messages', [])) == 8 and len(customer_b.get('messages', [])) == 6,
                'message_count_changed')
        require(len(owner_a.get('estimates', [])) == 1 and not owner_b.get('estimates'), 'estimate_count_changed')
        require(len(customer_a.get('photos', [])) == 1 and not customer_b.get('photos'), 'photo_count_changed')
        estimate = customer_a.get('estimate') or {}
        require(estimate.get('id') == self.state['estimateId'] and estimate.get('status') == 'published', 'published_estimate_missing')
        self.check_estimate(estimate)
        require(sum(message.get('operationId') == self.state['publish']['operationId'] for message in customer_a['messages']) == 1,
                'publication_message_not_unique')
        require(sum(message.get('operationId') == self.state['reply']['operationId'] and message.get('body') == self.state['reply']['body']
                    for message in customer_a['messages']) == 1, 'customer_reply_not_unique')
        photo_path = self.route() + '/photos/' + self.state['photoId']
        customer_photo, customer_headers = self.request(photo_path, token=self.payload()['accessToken'], binary=True)
        owner_photo, owner_headers = self.request('/owner/api' + photo_path, owner=True, binary=True)
        require(customer_photo == PNG and owner_photo == PNG and customer_headers.get('Content-Type') == 'image/png'
                and owner_headers.get('Content-Type') == 'image/png', 'private_photo_bytes_changed')
        found = set()
        cursor = None
        for _ in range(20):
            listing, _ = self.request('/owner/api/conversations' + ('?cursor=' + urllib.parse.quote(cursor, safe='') if cursor else ''), owner=True)
            for row in listing.get('conversations', []):
                if row.get('id') in {self.payload('A')['conversationId'], self.payload('B')['conversationId']}:
                    found.add(row['id'])
            if len(found) == 2 or not listing.get('nextCursor'):
                break
            cursor = listing['nextCursor']
        require(len(found) == 2, 'synthetic_requests_missing_from_owner_inbox')
        counts = {'synthetic_requests': 2, 'photos': 1, 'estimates': 1, 'messages': 14, 'stable_mutation_receipts': 6}
        snapshots = {'customerA': customer_a, 'customerB': customer_b, 'ownerA': owner_a, 'ownerB': owner_b,
                     'photo': digest(PNG), 'receipts': self.state['receipts']}
        return {'counts': counts, 'snapshot_sha256': digest(snapshots),
                'photo_sha256': digest(PNG), 'receipt_sha256': digest(self.state['receipts'])}

    def mutations(self, replay=False):
        self.create_records(replay)
        self.photo(replay)
        self.draft(replay)
        self.publish(replay)
        self.reply(replay)

    def cleanup(self):
        self.stage = 'synthetic_cleanup_identity_preflight'
        owners = {}
        snapshots = {}
        # Validate BOTH targets before any revocation. Never select by a name search.
        for label in ('A', 'B'):
            payload = self.payload(label)
            require(payload.get('intake') == synthetic_intake(label), 'cleanup_saved_identity_mismatch')
            owner = self.owner(label)
            conversation = owner.get('conversation', {})
            repair = conversation.get('repair', {})
            require(conversation.get('id') == payload['conversationId']
                    and all(repair.get(field) == value for field, value in synthetic_intake(label).items()),
                    'cleanup_owner_identity_mismatch')
            initial = [message for message in owner.get('messages', [])
                       if message.get('operationId') == payload['operationId']]
            require(len(initial) == 6
                    and [message.get('body') for message in initial if message.get('role') == 'customer']
                    == list(synthetic_intake(label).values()), 'cleanup_initial_operation_mismatch')
            receipt, _ = self.request('/owner/api' + self.route(label) + '/operations/' + payload['operationId'], owner=True)
            saved = receipt.get('receipt', {})
            require(saved.get('operationId') == payload['operationId']
                    and saved.get('messageId') == initial[-1].get('id')
                    and saved.get('sequence') == initial[-1].get('sequence'), 'cleanup_initial_receipt_mismatch')
            previous = self.state['receipts'].get('create' + label)
            require(previous is None or previous == saved, 'cleanup_saved_receipt_mismatch')
            require(isinstance(owner.get('guestAccess', {}).get('revoked'), bool), 'cleanup_guest_status_missing')
            owners[label] = owner
            snapshots[label] = digest({key: value for key, value in owner.items() if key != 'guestAccess'})
        cleanup = self.state.get('cleanup')
        if cleanup is None:
            cleanup = {'version': 1, 'startedAt': now(), 'ownerSnapshotSha256': snapshots, 'revoked': {}}
            self.state['cleanup'] = cleanup
            save_state(self.state)
        require(cleanup.get('version') == 1 and cleanup.get('ownerSnapshotSha256') == snapshots,
                'cleanup_retained_records_changed')
        for label in ('A', 'B'):
            self.stage = 'synthetic_cleanup_revoke_' + label.lower()
            if not owners[label]['guestAccess']['revoked']:
                # The owner endpoint uses COALESCE(revoked_at,...), so an uncertain
                # retry is idempotent. Readback on the next run avoids reposting.
                self.request('/owner/api' + self.route(label) + '/revoke', method='POST', body={}, owner=True)
            owner = self.owner(label)
            require(owner.get('guestAccess', {}).get('revoked') is True
                    and owner['guestAccess'].get('active') is False, 'synthetic_revoke_not_read_back')
            require(digest({key: value for key, value in owner.items() if key != 'guestAccess'}) == snapshots[label],
                    'cleanup_changed_retained_records')
            for path, options in ((self.route(label), {}),
                                  (self.route(label) + '/messages', {'method': 'POST', 'body': self.state['crossCustomerReply']})):
                denied, _ = self.request(path, token=self.payload(label)['accessToken'], expected=(410,), **options)
                require(denied.get('ok') is False and denied.get('error') == 'access_expired',
                        'revoked_customer_access_not_denied')
            if label == 'A' and self.state.get('photoId'):
                denied, _ = self.request(self.route(label) + '/photos/' + self.state['photoId'],
                                         token=self.payload(label)['accessToken'], expected=(410,))
                require(denied.get('ok') is False and denied.get('error') == 'access_expired',
                        'revoked_photo_access_not_denied')
                photo, _ = self.request('/owner/api' + self.route(label) + '/photos/' + self.state['photoId'],
                                        owner=True, binary=True)
                require(digest(photo) == self.state['photo']['sha256'], 'cleanup_owner_photo_changed')
            cleanup['revoked'][label] = True
            save_state(self.state)
        cleanup['completedAt'] = now()
        save_state(self.state)
        return {'ok': True, 'mode': 'cleanup', 'checked_at': cleanup['completedAt'],
                'configured_https_api_origin': self.origin, 'synthetic_accesses_revoked': 2,
                'synthetic_records_retained': True, 'owner_snapshots_unchanged': True,
                'private_state_retained': True, 'revoked_guest_reads_and_writes_denied': True,
                'retained_owner_snapshot_sha256': digest(snapshots), **reachability_scope()}

    def run(self, mode):
        if mode == 'cleanup':
            return self.cleanup()
        if mode == 'verify':
            require(self.snapshot() == self.state['baseline'], 'pre_retry_durable_snapshot_changed')
        else:
            # An interrupted resume must not retain an earlier completion marker.
            self.state.pop('completed', None)
            self.state.pop('serviceAtCompleted', None)
            save_state(self.state)
            self.mutations()
            self.security_checks()
            baseline = self.snapshot()
            previous = self.state.get('baseline')
            require(previous is None or previous == baseline, 'resumed_snapshot_changed')
            self.state['baseline'] = baseline
            save_state(self.state)
        self.mutations(replay=True)
        self.security_checks()
        actual = self.snapshot()
        require(actual == self.state['baseline'], 'exact_retry_changed_saved_state')
        if mode != 'verify':
            # Bind restart proof to the completed writes, never the start of an
            # interrupted create that could predate a restart and later resume.
            self.state['serviceAtCompleted'] = service_identity()
            self.state['completed'] = now()
        self.state['verifiedAt'] = now()
        save_state(self.state)
        return {'ok': True, 'mode': mode, 'checked_at': self.state['verifiedAt'],
                'configured_https_api_origin': self.origin, 'checks': self.state['checks'],
                'exact_retries_unchanged': True, **actual,
                'restart_survival_verified': mode == 'verify', **reachability_scope()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('create', 'resume', 'verify', 'cleanup'))
    args = parser.parse_args()
    checker = None
    try:
        require(hasattr(os, 'geteuid') and os.geteuid() == 0, 'run_as_root_on_ubuntu')
        origin, owner_key = read_environment()
        state = load_state(origin, args.mode)
        current_service = service_identity()
        if args.mode == 'verify':
            require(state.get('serviceAtCompleted') and state['serviceAtCompleted'] != current_service,
                    'service_restart_not_observed')
        elif args.mode != 'cleanup' and not state.get('serviceAtStart'):
            state['serviceAtStart'] = current_service
            save_state(state)
        checker = PublicChecks(origin, owner_key, state)
        print(json.dumps(checker.run(args.mode), indent=2))
        return 0
    except Exception as error:
        # Do not print request/response bodies, URLs with IDs, headers or exception messages.
        code = str(error) if isinstance(error, AcceptanceFailure) else type(error).__name__
        print(json.dumps({'ok': False, 'stage': checker.stage if checker else 'preflight', 'error': code,
                          'retry': ('Repeat cleanup with the original private state; do not replace it.'
                                    if args.mode == 'cleanup' or code == 'cleanup_started_use_cleanup_only'
                                    else 'Use resume with the original private state; do not replace it.'),
                          **reachability_scope()}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
