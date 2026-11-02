import {REQUEST_KEY, readSession} from './request-api.js';
import {calculateEstimate, formatMoney, UNKNOWN_ANSWER, validatePricingCatalog} from './estimate-pricing.js';

const form = document.querySelector('#estimate-form');
const root = document.querySelector('#estimate-assistant');
if (form && root) {
  const log = document.querySelector('#assistant-log');
  const step = document.querySelector('#assistant-question');
  const help = document.querySelector('#assistant-step-help');
  const error = document.querySelector('#assistant-error');
  const progress = document.querySelector('#assistant-progress');
  const back = document.querySelector('#assistant-back');
  const next = document.querySelector('#assistant-next');
  const unknown = document.querySelector('#assistant-unknown');
  const actions = document.querySelector('#assistant-actions');
  const result = document.querySelector('#assistant-result');
  const linesList = document.querySelector('#assistant-lines');
  const referencesList = document.querySelector('#assistant-references');
  const reviewList = document.querySelector('#assistant-owner-review');
  const total = document.querySelector('#assistant-total');
  const summary = document.querySelector('#assistant-summary');
  const requestFields = document.querySelector('#request-fields');
  const photoSection = document.querySelector('#request-photo-section');
  const submitSection = document.querySelector('#request-submit');
  const fallback = document.querySelector('#assistant-fallback');
  const state = {answers: {}, index: 0, catalog: null};
  const UNKNOWN = UNKNOWN_ANSWER;

  function choice(key, label, prompt, options, canSkip = true) {
    return {key, label, prompt, type: 'choice', options, canSkip};
  }

  function number(key, label, prompt, unit, minimum = 0, stepValue = 'any') {
    return {key, label, prompt, type: 'number', unit, minimum, stepValue: String(stepValue), maximum: 1000000, canSkip: true};
  }

  function text(key, label, prompt, type = 'text', maximum = 300) {
    return {key, label, prompt, type, maximum, canSkip: true};
  }

  function selectionOptions(values) {
    return values.map(([value, label]) => ({value, label}));
  }

  function questionsFor(answers) {
    const questions = [{
      key: 'service',
      label: 'Service',
      prompt: 'What kind of work do you need help with?',
      type: 'select',
      options: state.catalog.services.map(item => ({value: item.id, label: item.label})),
      canSkip: false
    }];
    const service = answers.service;

    if (service === 'gutters') {
      questions.push(choice('gutterLayout', 'Gutter layout', 'Are the gutter sections one story, two stories, or mixed height?', selectionOptions([
        ['one_story', 'One-story sections'],
        ['two_story', 'Two-story sections'],
        ['mixed', 'A mix of one- and two-story sections']
      ])));
      const layout = answers.gutterLayout;
      if (layout === 'one_story' || layout === 'mixed') questions.push(number('singleStoryFeet', 'One-story gutter length', 'About how many linear feet are on one-story sections?', 'linear feet', 0.1));
      if (layout === 'two_story' || layout === 'mixed') questions.push(number('twoStoryFeet', 'Two-story gutter length', 'About how many linear feet are on two-story sections?', 'linear feet', 0.1));
      if (layout === 'one_story' || layout === 'mixed') questions.push(number('singleDownspouts', 'One-story downspouts', 'How many one-story downspouts are needed?', 'downspouts', 0, 1));
      if (layout === 'two_story' || layout === 'mixed') questions.push(number('twoDownspouts', 'Two-story downspouts', 'How many two-story downspouts are needed?', 'downspouts', 0, 1));
      questions.push(choice('removeExistingGutters', 'Existing gutters', 'Do the existing gutters need to be removed?', selectionOptions([
        ['yes', 'Yes'],
        ['no', 'No']
      ])));
    } else if (service === 'standard_screens') {
      questions.push(choice('screenPanelType', 'Panel type', 'Which screen panel needs repair?', selectionOptions([
        ['lower_standard', 'Standard lower wall panel'],
        ['upper_standard', 'Standard upper wall panel'],
        ['florida_glass', 'Lower Florida Glass panel'],
        ['pet_screen', 'Lower pet screen panel'],
        ['picture_window', 'Picture-window screen'],
        ['oversized', 'Oversized or custom panel']
      ])));
      questions.push(number('panelCount', 'Panel quantity', 'How many panels need replacement?', 'panels', 1, 1));
      if (answers.screenPanelType === 'picture_window') {
        questions.push(number('pictureWidth', 'Picture-window width', 'About how wide is the picture window?', 'feet', 0.1));
        questions.push(number('pictureHeight', 'Picture-window height', 'About how tall is the picture window?', 'feet', 0.1));
      } else if (answers.screenPanelType && answers.screenPanelType !== 'oversized') {
        questions.push(choice('panelSize', 'Panel size', 'Are these normal-sized panels, about 6 feet by 7 feet or larger, or are you unsure?', selectionOptions([
          ['normal', 'Normal-sized panels'],
          ['oversized', 'About 6 feet by 7 feet or larger'],
          ['unsure', 'I am not sure']
        ])));
      }
      if (answers.screenPanelType && answers.screenPanelType !== 'oversized') {
        questions.push(choice('screenMaterial', 'Screen material', 'Do you want standard mesh or Super Screen?', selectionOptions([
          ['standard', 'Standard mesh'],
          ['superScreen', 'Super Screen']
        ])));
      }
      questions.push(choice('frameCondition', 'Frame condition', 'Is the existing frame reusable and free of visible damage?', selectionOptions([
        ['ok', 'Yes, it appears reusable'],
        ['damaged', 'No, it is damaged'],
        ['unsure', 'I am not sure']
      ])));
    } else if (service === 'pool_panels') {
      questions.push(choice('poolPanelType', 'Panel location', 'Where is the damaged pool enclosure panel?', selectionOptions([
        ['lower', 'Lower wall'],
        ['upper', 'Upper wall'],
        ['roof', 'Roof']
      ])));
      questions.push(number('poolPanelCount', 'Panel quantity', 'How many panels need replacement?', 'panels', 1, 1));
      questions.push(choice('poolPanelSize', 'Panel size', 'Are these normal-sized panels?', selectionOptions([
        ['normal', 'Yes, normal-sized'],
        ['unusual', 'No, unusually large'],
        ['unsure', 'I am not sure']
      ])));
      questions.push(choice('poolScreenMaterial', 'Screen material', 'Do you want standard mesh or Super Screen?', selectionOptions([
        ['standard', 'Standard mesh'],
        ['superScreen', 'Super Screen']
      ])));
      questions.push(choice('frameCondition', 'Frame condition', 'Is the enclosure frame in good condition?', selectionOptions([
        ['ok', 'Yes'],
        ['damaged', 'No, the frame is damaged'],
        ['unsure', 'I am not sure']
      ])));
    } else if (service === 'pool_restoration') {
      questions.push({
        key: 'restorationServices',
        label: 'Restoration services',
        prompt: 'Which restoration services are you considering?',
        type: 'checkboxes',
        canSkip: true,
        options: selectionOptions([
          ['rescreening', 'Enclosure rescreening'],
          ['cleaning', 'Enclosure cleaning'],
          ['hurricane_cables', 'Hurricane cable installation'],
          ['paint_rescreening', 'Painting, rescrewing, and new screening']
        ])
      });
      if (Array.isArray(answers.restorationServices) && answers.restorationServices.includes('hurricane_cables')) {
        questions.push(number('cableCount', 'Hurricane cable quantity', 'How many cables are being considered?', 'cables', 1, 1));
      }
      if (Array.isArray(answers.restorationServices) && answers.restorationServices.includes('paint_rescreening')) {
        questions.push(number('runCount', 'Restoration runs', 'If John has already defined a run for this project, how many runs did he identify?', 'runs', 1, 1));
      }
      questions.push(choice('frameCondition', 'Frame condition', 'Is there frame damage, corrosion, or a missing support?', selectionOptions([
        ['ok', 'No visible structural concern'],
        ['damaged', 'Yes, there is a concern'],
        ['unsure', 'I am not sure']
      ])));
    } else if (service === 'window_rescreen') {
      questions.push(choice('wholeHome', 'Whole-home scope', 'Are all window screens in the home being rescreened?', selectionOptions([
        ['yes', 'Yes, all window screens'],
        ['no', 'No, only some screens']
      ])));
      questions.push(number('windowCount', 'Window screen quantity', 'How many window screens are there?', 'screens', 1, 1));
      questions.push(choice('framesReusable', 'Existing frames', 'Can the existing frames be reused?', selectionOptions([
        ['yes', 'Yes'],
        ['no', 'No, some frames need work'],
        ['unsure', 'I am not sure']
      ])));
      questions.push(choice('customWindowSizes', 'Window sizes', 'Are any frames custom-sized or unusual?', selectionOptions([
        ['no', 'No'],
        ['yes', 'Yes'],
        ['unsure', 'I am not sure']
      ])));
    } else if (service === 'patio_door') {
      questions.push(number('patioDoorCount', 'Patio door quantity', 'How many existing sliding patio screen doors need rescreening?', 'doors', 1, 1));
      questions.push(text('patioDoorSize', 'Door size', 'What are the approximate door dimensions, if you know them? Include units.'));
      questions.push(choice('frameCondition', 'Frame condition', 'Is the existing door frame reusable?', selectionOptions([
        ['ok', 'Yes'],
        ['damaged', 'No, it is damaged'],
        ['unsure', 'I am not sure']
      ])));
      questions.push(choice('rescreenExistingDoor', 'Work requested', 'Are you asking to rescreen the existing door, rather than replace the complete door?', selectionOptions([
        ['yes', 'Rescreen the existing door'],
        ['no', 'Replace the complete door']
      ])));
    } else if (service === 'aluminum_door') {
      questions.push(number('aluminumDoorCount', 'Door quantity', 'How many aluminum screen doors need replacement?', 'doors', 1, 1));
      questions.push(text('aluminumDoorSize', 'Door size', 'What are the approximate door dimensions or style, if known?'));
      questions.push(choice('aluminumFrameCondition', 'Frame condition', 'Is the surrounding frame in good condition?', selectionOptions([
        ['ok', 'Yes'],
        ['damaged', 'No, it needs attention'],
        ['unsure', 'I am not sure']
      ])));
    } else if (service === 'regular_door') {
      questions.push(choice('doorSections', 'Door sections', 'Which existing screen door sections need new screen material?', selectionOptions([
        ['bottom', 'Bottom section'],
        ['top', 'Top section'],
        ['both', 'Both sections']
      ])));
      questions.push(number('regularDoorCount', 'Door quantity', 'How many doors need rescreening?', 'doors', 1, 1));
      questions.push(choice('rescreenExistingDoor', 'Work requested', 'Are you asking to rescreen the existing door, rather than replace the complete door?', selectionOptions([
        ['yes', 'Rescreen the existing door'],
        ['no', 'Replace the complete door']
      ])));
    } else if (service === 'other') {
      questions.push(text('otherService', 'Service details', 'What screen or gutter work do you have in mind?', 'textarea', 600));
    }

    questions.push(text('desiredDate', 'Desired completion date', 'When would you like the work completed? An approximate date is fine.'));
    questions.push(text('accessConditions', 'Access conditions', 'Are there gate, parking, pet, or access details John should know?', 'textarea', 400));
    questions.push(text('additionalWork', 'Additional work', 'Is there any other work to include in the request?', 'textarea', 400));
    return questions;
  }

  function inputLabel(question, control, suffix = '') {
    const label = document.createElement('label');
    label.htmlFor = control.id;
    label.textContent = question + suffix;
    return label;
  }

  function renderControl(question) {
    const current = state.answers[question.key];
    if (question.type === 'select') {
      const select = document.createElement('select');
      select.id = 'assistant-answer';
      select.setAttribute('aria-describedby', 'assistant-step-help');
      const prompt = document.createElement('option');
      prompt.value = '';
      prompt.textContent = 'Choose one';
      select.append(prompt);
      for (const option of question.options) {
        const item = document.createElement('option');
        item.value = option.value;
        item.textContent = option.label;
        item.selected = current === option.value;
        select.append(item);
      }
      step.append(inputLabel(question.label, select), select);
      return select;
    }
    if (question.type === 'choice' || question.type === 'checkboxes') {
      const group = document.createElement('div');
      group.className = 'assistant-options';
      const isMultiple = question.type === 'checkboxes';
      for (const option of question.options) {
        const label = document.createElement('label');
        label.className = 'assistant-option';
        const control = document.createElement('input');
        control.type = isMultiple ? 'checkbox' : 'radio';
        control.name = 'assistant-answer';
        control.value = option.value;
        control.checked = isMultiple ? Array.isArray(current) && current.includes(option.value) : current === option.value;
        label.append(control, document.createTextNode(option.label));
        group.append(label);
      }
      step.append(group);
      return group.querySelector('input');
    }
    const control = document.createElement(question.type === 'textarea' ? 'textarea' : 'input');
    control.id = 'assistant-answer';
    control.setAttribute('aria-describedby', 'assistant-step-help');
    if (question.type === 'number') {
      control.type = 'number';
      control.min = String(question.minimum);
      control.max = String(question.maximum);
      control.step = String(question.stepValue);
      control.inputMode = question.stepValue === '1' ? 'numeric' : 'decimal';
    } else if (question.type !== 'textarea') {
      control.type = 'text';
    }
    control.maxLength = question.maximum;
    control.value = current && current !== UNKNOWN ? current : '';
    step.append(inputLabel(question.label, control, question.unit ? ' (' + question.unit + ')' : ''), control);
    return control;
  }

  function answerText(question, value) {
    if (value === UNKNOWN) return 'Not sure yet; please ask John to review.';
    if (Array.isArray(value)) return value.map(item => question.options.find(option => option.value === item)?.label || item).join(', ');
    if (question.options) return question.options.find(option => option.value === value)?.label || value;
    return String(value);
  }

  function recordAnswer(value) {
    const questions = questionsFor(state.answers);
    const question = questions[state.index];
    if (!question) return;
    const old = state.answers[question.key];
    if (question.key === 'service' && old !== value) {
      state.answers = {service: value};
      state.index = 1;
    } else {
      if (JSON.stringify(old) !== JSON.stringify(value)) {
        for (const later of questions.slice(state.index + 1)) delete state.answers[later.key];
      }
      state.answers[question.key] = value;
      state.index++;
    }
    renderHistoryMessage('customer', answerText(question, value));
    renderQuestion();
  }

  function readAnswer() {
    const question = questionsFor(state.answers)[state.index];
    if (!question) return;
    if (question.type === 'choice') {
      const selected = step.querySelector('input[name="assistant-answer"]:checked');
      if (!selected) throw Error('Choose an option, or mark this detail for John to review.');
      return selected.value;
    }
    if (question.type === 'checkboxes') {
      const selected = [...step.querySelectorAll('input[name="assistant-answer"]:checked')].map(item => item.value);
      if (!selected.length) throw Error('Choose at least one service, or mark this detail for John to review.');
      return selected;
    }
    const control = step.querySelector('#assistant-answer');
    const value = control.value.trim();
    if (!value) {
      if (question.canSkip) return UNKNOWN;
      throw Error('Choose a service to continue.');
    }
    if (question.type === 'number') {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < question.minimum || parsed > question.maximum) throw Error('Enter a number in the range shown, or choose the not-sure option.');
      if (question.stepValue === '1' && !Number.isInteger(parsed)) throw Error('Enter a whole-number quantity, or choose the not-sure option.');
    }
    return value;
  }

  function answerForSummary(question, value) {
    if (value === UNKNOWN) return 'Not sure; please ask John to review';
    if (Array.isArray(value)) return value.map(item => question.options.find(option => option.value === item)?.label || item).join(', ');
    if (question.options) return question.options.find(option => option.value === value)?.label || value;
    if (question.unit) return String(value) + ' ' + question.unit;
    return String(value);
  }

  function makeSummary(estimate) {
    const questions = questionsFor(state.answers);
    const detailLines = questions.filter(question => Object.hasOwn(state.answers, question.key)).map(question => '- ' + question.label + ': ' + answerForSummary(question, state.answers[question.key]));
    const output = [
      'PRELIMINARY ESTIMATE — not a binding quote.',
      'Service: ' + (state.catalog.services.find(item => item.id === state.answers.service)?.label || 'Other screen or gutter service'),
      'Pricing catalog version: ' + state.catalog.catalogVersion,
      'Customer-provided project details (not site-verified):',
      ...detailLines,
      'Preliminary line items:'
    ];
    if (estimate.lines.length) output.push(...estimate.lines.map(line => '- ' + line.label + ': ' + line.detail));
    else output.push('- No priced line items are available from the supplied details.');
    if (estimate.references.length) output.push('Price references requiring owner confirmation:', ...estimate.references.map(item => '- ' + item));
    if (estimate.lines.length) {
      output.push(estimate.minimum === estimate.maximum ? 'Preliminary subtotal for listed items: ' + formatMoney(estimate.minimum) : 'Preliminary range for listed items: ' + formatMoney(estimate.minimum) + ' to ' + formatMoney(estimate.maximum));
    } else {
      output.push('Preliminary subtotal: not calculated.');
    }
    if (estimate.review.length) output.push('Items for John to review:', ...estimate.review.map(item => '- ' + item));
    output.push('John must review the request and confirm the final scope and price. This request does not book an appointment.');
    return output.join('\n');
  }

  function renderEstimate() {
    const estimate = calculateEstimate(state.answers, state.catalog);
    step.hidden = true;
    actions.hidden = true;
    result.hidden = false;
    linesList.replaceChildren();
    referencesList.replaceChildren();
    reviewList.replaceChildren();
    for (const line of estimate.lines) {
      const item = document.createElement('li');
      item.textContent = line.label + ' — ' + line.detail;
      linesList.append(item);
    }
    if (!estimate.lines.length) {
      const item = document.createElement('li');
      item.textContent = 'No priced line items are available from the supplied details.';
      linesList.append(item);
    }
    for (const reference of estimate.references) {
      const item = document.createElement('li');
      item.textContent = reference;
      referencesList.append(item);
    }
    for (const itemText of estimate.review) {
      const item = document.createElement('li');
      item.textContent = itemText;
      reviewList.append(item);
    }
    referencesList.closest('.assistant-review-block').hidden = !estimate.references.length;
    reviewList.closest('.assistant-review-block').hidden = !estimate.review.length;
    total.textContent = estimate.lines.length
      ? estimate.minimum === estimate.maximum
        ? 'Preliminary subtotal for listed items: ' + formatMoney(estimate.minimum)
        : 'Preliminary range for listed items: ' + formatMoney(estimate.minimum) + ' to ' + formatMoney(estimate.maximum)
      : 'No preliminary subtotal is available from the supplied details.';
    summary.value = makeSummary(estimate);
    syncLegacyFields();
    requestFields.hidden = false;
    photoSection.hidden = false;
    submitSection.hidden = false;
    renderHistoryMessage('assistant', 'That covers the project questions. Review the preliminary breakdown, then add your contact details and optional photos below.');
    document.querySelector('#form-heading').textContent = 'Review and send your request';
    document.querySelector('#name').focus();
  }

  function syncLegacyFields() {
    const gutterService = state.answers.service === 'gutters';
    const storiesField = document.querySelector('#stories-field');
    const gutterLengthField = document.querySelector('#gutter-length-field');
    const stories = document.querySelector('#stories');
    const gutterLength = document.querySelector('#gutterLength');
    storiesField.hidden = !gutterService;
    gutterLengthField.hidden = !gutterService;
    stories.disabled = gutterService;
    gutterLength.readOnly = gutterService;
    if (!gutterService) {
      stories.value = '';
      gutterLength.value = '';
      return;
    }
    const layout = state.answers.gutterLayout;
    stories.value = layout === 'one_story' ? '1' : layout === 'two_story' ? '2' : '';
    const single = state.answers.singleStoryFeet;
    const two = state.answers.twoStoryFeet;
    if (layout === 'one_story') gutterLength.value = single && single !== UNKNOWN ? single + ' linear feet' : '';
    else if (layout === 'two_story') gutterLength.value = two && two !== UNKNOWN ? two + ' linear feet' : '';
    else if (layout === 'mixed') gutterLength.value = [
      single && single !== UNKNOWN ? single + ' single-story feet' : 'single-story footage unknown',
      two && two !== UNKNOWN ? two + ' two-story feet' : 'two-story footage unknown'
    ].join('; ');
    else gutterLength.value = '';
  }

  function setError(message) {
    error.textContent = message;
    error.hidden = !message;
  }

  function setManualFormVisible(visible) {
    requestFields.hidden = !visible;
    photoSection.hidden = !visible;
    submitSection.hidden = !visible;
  }

  function renderQuestion() {
    const questions = questionsFor(state.answers);
    const question = questions[state.index];
    if (!question) {
      renderEstimate();
      return;
    }
    result.hidden = true;
    setManualFormVisible(false);
    step.hidden = false;
    actions.hidden = false;
    step.replaceChildren();
    const legend = document.createElement('legend');
    legend.tabIndex = -1;
    legend.textContent = question.prompt;
    step.append(legend);
    const firstControl = renderControl(question);
    help.textContent = question.unit
      ? 'Enter an approximate value in ' + question.unit + '. If you are unsure, choose the not-sure option.'
      : 'Answer what you can. Unknown details can be left for John to review.';
    progress.textContent = 'Question ' + (state.index + 1) + ' of ' + questions.length;
    back.disabled = state.index === 0;
    unknown.hidden = !question.canSkip;
    next.textContent = state.index === questions.length - 1 ? 'Review preliminary estimate' : 'Continue';
    setError('');
    firstControl?.focus();
  }

  function renderHistoryMessage(role, content) {
    const turn = document.createElement('p');
    turn.className = 'assistant-turn';
    turn.dataset.role = role;
    const speaker = document.createElement('strong');
    speaker.textContent = role === 'assistant' ? 'Estimate assistant' : 'You';
    const message = document.createElement('span');
    message.textContent = content;
    turn.append(speaker, message);
    log.append(turn);
    log.scrollTop = log.scrollHeight;
  }

  function startAssistant() {
    state.answers = {};
    state.index = 0;
    summary.value = '';
    result.hidden = true;
    log.replaceChildren();
    document.querySelector('#form-heading').textContent = 'Your project details';
    setManualFormVisible(false);
    renderHistoryMessage('assistant', 'I will ask about one service at a time and calculate a preliminary amount from the listed price catalog. John reviews the final scope and price.');
    renderQuestion();
  }

  function startReviewEdit() {
    state.index = Math.max(0, questionsFor(state.answers).length - 1);
    renderHistoryMessage('assistant', 'You can go back through your answers to change the project details.');
    renderQuestion();
  }

  next.addEventListener('click', () => {
    try {
      recordAnswer(readAnswer());
    } catch (caught) {
      setError(caught.message);
      step.querySelector('input,select,textarea')?.focus();
    }
  });
  unknown.addEventListener('click', () => recordAnswer(UNKNOWN));
  back.addEventListener('click', () => {
    if (state.index === 0) return;
    state.index--;
    const question = questionsFor(state.answers)[state.index];
    renderHistoryMessage('assistant', 'Let us revisit: ' + question.prompt);
    renderQuestion();
  });
  document.querySelector('#assistant-edit').addEventListener('click', startReviewEdit);
  document.querySelector('#start-another-request').addEventListener('click', startAssistant);
  step.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing && event.target.matches('input[type="text"],input[type="number"]')) {
      event.preventDefault();
      next.click();
    }
  });
  step.addEventListener('input', () => setError(''));
  step.addEventListener('change', () => setError(''));

  async function initialize() {
    if (readSession(REQUEST_KEY)?.payload) return;
    setManualFormVisible(false);
    fallback.hidden = false;
    fallback.textContent = 'Loading the preliminary estimate assistant…';
    try {
      const response = await fetch(new URL('../pricing-catalog.json', import.meta.url), {
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer'
      });
      if (!response.ok) throw Error('The price catalog is not available.');
      const catalog = await response.json();
      state.catalog = validatePricingCatalog(catalog);
      root.hidden = false;
      fallback.hidden = true;
      startAssistant();
    } catch {
      root.hidden = true;
      setManualFormVisible(true);
      fallback.hidden = false;
      fallback.textContent = 'The estimate assistant is unavailable. You can still send John a request for a manual estimate using the form below.';
    }
  }

  void initialize();
}
