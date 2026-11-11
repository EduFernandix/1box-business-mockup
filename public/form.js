// Quote form: same client behaviour as business.1box.nl (validate facility + email,
// then "Een moment…" → "Doorsturen…"). This is a mockup: nothing is sent anywhere.
(function () {
  // mobile menu button
  const burger = document.querySelector('.site-header .burger');
  if (burger) { burger.setAttribute('aria-expanded', 'false'); burger.addEventListener('click', () => { const open = burger.closest('.site-header').classList.toggle('open'); burger.setAttribute('aria-expanded', String(open)); }); }

  const form = document.querySelector('form.quote-form');
  if (!form) return;
  const card = form.closest('.quote-card');
  const facility = form.querySelector('select[name="facility"]');
  const kind = form.querySelector('select[name="storageKind"]');
  const email = form.querySelector('input[name="email"]');
  const btn = form.querySelector('button[type="submit"]');
  const label = btn.querySelector('span');
  const formError = card.querySelector('.form-error');

  function showErr(name, msg) {
    const el = form.querySelector('.field-error[data-err="' + name + '"]');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }
  function clearErrors() { showErr('facility'); showErr('email'); if (formError) formError.hidden = true; }

  function goToForm(focusEl) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => focusEl && focusEl.focus({ preventScroll: true }), 600);
  }

  facility.addEventListener('change', () => showErr('facility'));
  email.addEventListener('input', () => showErr('email'));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors();
    let ok = true;
    if (!facility.value) { showErr('facility', 'Kies een opslaglocatie'); ok = false; }
    const v = email.value.trim();
    if (!v) { showErr('email', 'Vul je e-mailadres in'); ok = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { showErr('email', 'Vul een geldig e-mailadres in'); ok = false; }
    if (!ok) return;
    btn.disabled = true;
    label.textContent = 'Een moment…';
    setTimeout(() => { label.textContent = 'Doorsturen…'; }, 700);
    setTimeout(() => { btn.disabled = false; label.textContent = 'Nu reserveren'; }, 2600);
  });

  // Storage-option cards / rows: preselect the kind and jump to the form
  document.querySelectorAll('[data-kind]').forEach((el) => el.addEventListener('click', () => {
    if (window.__commentMode) return;
    kind.value = el.dataset.kind;
    goToForm(facility);
  }));
  // Location chips: preselect the location
  document.querySelectorAll('[data-loc]').forEach((el) => el.addEventListener('click', () => {
    if (window.__commentMode) return;
    facility.value = el.dataset.loc;
    showErr('facility');
    goToForm(form.querySelector('input[name="contactName"]'));
  }));
  // Bottom CTA (variation B): carry the chosen location into the form
  document.querySelectorAll('[data-action="quick"]').forEach((el) => el.addEventListener('click', () => {
    if (window.__commentMode) return;
    const quick = document.getElementById('b-quick');
    if (quick && quick.value) { facility.value = quick.value; showErr('facility'); goToForm(form.querySelector('input[name="contactName"]')); }
    else { showErr('facility', 'Kies een opslaglocatie'); goToForm(facility); }
  }));
})();
