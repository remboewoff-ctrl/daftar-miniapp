(function () {
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

  const state = {
    today: '',
    smsMode: 'demo',
    settings: null,
    summary: null,
    debts: [],
    smsLogs: [],
    activeTab: 'home',
    debtFilter: 'all',
    searchQuery: '',
    selectedDebtId: null,
    lookupExistingTotal: 0,
  };

  // Init Telegram Mini App
  if (tg) {
    try {
      tg.ready();
      tg.expand();
      if (tg.colorScheme === 'dark') {
        document.body.classList.add('dark');
      }
      tg.onEvent('themeChanged', () => {
        document.body.classList.toggle('dark', tg.colorScheme === 'dark');
      });
    } catch (_) {}
  }

  function haptic(type = 'light') {
    try {
      tg?.HapticFeedback?.impactOccurred(type);
    } catch (_) {}
  }

  function formatSum(val) {
    return `${Number(val || 0)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so'm`;
  }

  function formatPlainNumber(val) {
    return Number(val || 0)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function formatPhoneDisplay(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('998')) {
      return `+998 ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 10)} ${digits.slice(10, 12)}`;
    }
    return phone;
  }

  function formatLocalPhoneInput(raw) {
    const digits = raw.replace(/\D/g, '').slice(0, 9);
    const parts = [];
    if (digits.length > 0) parts.push(digits.slice(0, 2));
    if (digits.length > 2) parts.push(digits.slice(2, 5));
    if (digits.length > 5) parts.push(digits.slice(5, 7));
    if (digits.length > 7) parts.push(digits.slice(7, 9));
    return parts.join(' ');
  }

  function addDays(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return dt.toISOString().slice(0, 10);
  }

  function formatDateTime(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString('uz-UZ', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (_) {
      return iso;
    }
  }

  function initials(name) {
    return String(name || 'M')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('');
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function api(url, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (tg?.initData) {
      headers['X-Telegram-Init-Data'] = tg.initData;
    }
    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Server xatoligi');
    }
    return data;
  }

  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  let smsToastTimer = null;
  function showSmsPhonePopup(smsLog) {
    if (!smsLog) return;
    const box = document.getElementById('smsPhoneToast');
    document.getElementById('smsToastMeta').textContent = `${formatPhoneDisplay(
      smsLog.phone
    )} • ${smsLog.provider === 'eskiz' ? 'Eskiz.uz orqali yuborildi' : 'Demo SMS simulyatsiya'}`;
    document.getElementById('smsToastBody').textContent = smsLog.message;
    box.classList.add('show');
    clearTimeout(smsToastTimer);
    smsToastTimer = setTimeout(() => box.classList.remove('show'), 7000);
  }

  document.getElementById('closeSmsToastBtn').addEventListener('click', () => {
    document.getElementById('smsPhoneToast').classList.remove('show');
  });

  // Theme Toggle
  document.getElementById('themeToggleBtn').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    haptic('light');
  });

  // Tab Navigation
  function switchTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');
    document.querySelectorAll('.nav-item').forEach((n) => {
      n.classList.toggle('active', n.dataset.tab === tabName);
    });
    document.getElementById('fabAddDebt').style.display =
      tabName === 'debts' || tabName === 'home' ? 'grid' : 'none';
    haptic('light');
  }

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.querySelectorAll('[data-go-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.goTab));
  });

  // Modals
  function openModal(id) {
    const el = document.getElementById(id);
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
  }

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
  });

  document.querySelectorAll('.sheet-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal(backdrop.id);
    });
  });

  // Render helpers
  function statusBadgeHtml(debt) {
    if (debt.status === 'overdue') {
      return `<span class="status-pill overdue">⚠ ${debt.overdueDays} kun o'tgan (${debt.dueDate})</span>`;
    }
    if (debt.status === 'due_today') {
      return `<span class="status-pill due_today">⏰ Muddat bugun (${debt.dueDate})</span>`;
    }
    if (debt.status === 'paid') {
      return `<span class="status-pill paid">✓ To'langan</span>`;
    }
    return `<span class="status-pill active">📅 Muddat: ${debt.dueDate}</span>`;
  }

  function renderDebtCard(debt, showQuickRemind = false) {
    const pct = debt.totalAmount > 0 ? Math.round((debt.paidAmount / debt.totalAmount) * 100) : 0;
    const canRemind = debt.status === 'overdue' || debt.status === 'due_today';
    const tierBadge =
      debt.status !== 'paid' && debt.debtTier === 'high'
        ? `<span class="status-pill overdue" style="font-size:10px">🔥 Katta qarz</span>`
        : debt.status !== 'paid' && debt.debtTier === 'small'
        ? `<span class="status-pill" style="font-size:10px;background:var(--surface-muted);color:var(--text-secondary)">Mayda qarz (SMSsiz)</span>`
        : '';

    return `
      <div class="debt-card ${debt.status}" data-debt-id="${debt.id}">
        <div class="debt-card-top">
          <div class="customer-ident">
            <div class="avatar">${escapeHtml(initials(debt.customerName))}</div>
            <div style="min-width:0">
              <div class="customer-name">${escapeHtml(debt.customerName)} ${tierBadge}</div>
              <div class="customer-phone">${escapeHtml(formatPhoneDisplay(debt.phone))}</div>
            </div>
          </div>
          <div class="debt-amount-col">
            <div class="debt-remaining">${
              debt.status === 'paid' ? formatSum(debt.totalAmount) : formatSum(debt.remainingAmount)
            }</div>
            ${
              debt.customerTotalDebt > debt.remainingAmount
                ? `<div class="debt-total-sub">Jami qarzi: ${formatSum(debt.customerTotalDebt)}</div>`
                : debt.paidAmount > 0 && debt.remainingAmount > 0
                ? `<div class="debt-total-sub">Jami xarid: ${formatSum(debt.totalAmount)}</div>`
                : ''
            }
          </div>
        </div>
        <div class="debt-items-line">🛒 ${escapeHtml(debt.items || "Do'kondan xarid")}</div>
        <div class="debt-card-bottom">
          ${statusBadgeHtml(debt)}
          ${
            showQuickRemind && canRemind
              ? `<button class="mini-remind-btn ${debt.status}" data-quick-remind="${debt.id}" type="button">📩 SMS eslatma</button>`
              : `<span class="sms-card-meta">SMS: ${debt.reminderCount || 0} ta eslatma</span>`
          }
        </div>
        ${
          debt.paidAmount > 0 && debt.remainingAmount > 0
            ? `<div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>`
            : ''
        }
      </div>
    `;
  }

  function smsTypeLabel(type) {
    const map = {
      created: 'Yangi qarz',
      overdue: "Muddati o'tgan eslatma",
      before_due: 'Oldindan eslatma',
      payment: "To'lov cheki",
      manual: 'Qo‘lda eslatma',
    };
    return map[type] || 'SMS';
  }

  function renderSmsCard(log) {
    const badgeClass = log.type === 'overdue' ? 'overdue' : log.type === 'payment' ? 'paid' : 'active';
    const statusLabel =
      log.status === 'sent'
        ? '✓ Yuborildi (Eskiz)'
        : log.status === 'failed'
        ? '✕ Xatolik'
        : '✓ Demo yuborildi';

    return `
      <div class="sms-card">
        <div class="sms-card-head">
          <div>
            <div class="sms-card-title">${escapeHtml(log.customerName)}</div>
            <div class="sms-card-meta">${escapeHtml(formatPhoneDisplay(log.phone))}</div>
          </div>
          <span class="status-pill ${badgeClass}">${smsTypeLabel(log.type)}</span>
        </div>
        <div class="sms-card-msg">${escapeHtml(log.message)}</div>
        <div class="sms-card-foot">
          <span>${statusLabel}</span>
          <span>${formatDateTime(log.createdAt)}</span>
        </div>
      </div>
    `;
  }

  function renderAll() {
    if (!state.summary) return;

    const tgUser = tg?.initDataUnsafe?.user;
    const ownerLabel = tgUser ? `${tgUser.first_name}` : '@DaftarUzBot';
    document.getElementById('headerStoreSubtitle').textContent = `${state.settings.storeName} • ${ownerLabel}`;

    const modePill = document.getElementById('smsModePill');
    modePill.textContent =
      state.smsMode === 'eskiz'
        ? 'Eskiz Live'
        : state.smsMode === 'playmobile'
        ? 'PlayMobile'
        : 'Demo SMS';
    modePill.classList.toggle('live', state.smsMode !== 'demo');

    // Summary
    document.getElementById('statTotalOutstanding').textContent = formatSum(
      state.summary.totalOutstanding
    );
    document.getElementById('statTotalOverdue').textContent = formatSum(state.summary.totalOverdue);
    document.getElementById('statOverdueCount').textContent = `${state.summary.overdueCount} ta muddati o'tgan`;
    document.getElementById('statTotalPaid').textContent = formatSum(state.summary.totalPaid);
    document.getElementById('statSmsCount').textContent = `${state.summary.smsCount} ta SMS`;
    document.getElementById('heroActiveCustomers').textContent = `${state.summary.activeCount} ta faol qarz`;

    // Urgent debts
    const urgent = state.debts.filter((d) => d.status === 'overdue' || d.status === 'due_today');
    const urgentEl = document.getElementById('urgentDebtsList');
    urgentEl.innerHTML = urgent.length
      ? urgent.map((d) => renderDebtCard(d, true)).join('')
      : `<div class="empty-state">🎉 Hozircha muddati o'tgan yoki bugungi qarzlar yo'q</div>`;

    // Home SMS preview
    const homeSmsEl = document.getElementById('homeSmsList');
    const recentSms = state.smsLogs.slice(0, 3);
    homeSmsEl.innerHTML = recentSms.length
      ? recentSms.map(renderSmsCard).join('')
      : `<div class="empty-state">Hali SMS yuborilmagan</div>`;

    // Debts tab list
    renderDebtsList();

    // Full SMS tab
    const fullSmsEl = document.getElementById('fullSmsLogList');
    fullSmsEl.innerHTML = state.smsLogs.length
      ? state.smsLogs.map(renderSmsCard).join('')
      : `<div class="empty-state">SMS tarixi bo'sh</div>`;

    // Settings inputs
    const s = state.settings;
    const rules = s.smsRules || {};
    document.getElementById('setStoreName').value = s.storeName || '';
    document.getElementById('setStorePhone').value = s.storePhone || '';
    document.getElementById('setAutoSendOnCreate').checked = Boolean(s.autoSendOnCreate);
    document.getElementById('setRemindOnDueDate').checked = Boolean(s.remindOnDueDate);
    document.getElementById('setMinDebtForSms').value = String(rules.minDebtForSms ?? 10000);
    document.getElementById('setHighDebtThreshold').value = String(rules.highDebtThreshold ?? 500000);
    document.getElementById('setRemindBeforeDays').value = String(s.remindBeforeDays ?? 1);
    document.getElementById('setNormalRepeatDays').value = String(rules.normalRepeatDays ?? 3);
    document.getElementById('setHighDebtRepeatDays').value = String(rules.highDebtRepeatDays ?? 1);
    document.getElementById('tplCreated').value = s.templates?.created || '';
    document.getElementById('tplOverdue').value = s.templates?.overdue || '';
    document.getElementById('tplHighDebtOverdue').value = s.templates?.highDebtOverdue || '';
    document.getElementById('tplPaid').value = s.templates?.paid || '';
  }

  function renderDebtsList() {
    const q = state.searchQuery.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    const filtered = state.debts.filter((d) => {
      if (state.debtFilter !== 'all' && d.status !== state.debtFilter) return false;
      if (!q) return true;
      const nameMatch = d.customerName.toLowerCase().includes(q);
      const phoneMatch = qDigits ? d.phone.replace(/\D/g, '').includes(qDigits) : false;
      const itemMatch = (d.items || '').toLowerCase().includes(q);
      return nameMatch || phoneMatch || itemMatch;
    });

    const el = document.getElementById('allDebtsList');
    el.innerHTML = filtered.length
      ? filtered.map((d) => renderDebtCard(d, true)).join('')
      : `<div class="empty-state">Mos qarz topilmadi</div>`;
  }

  async function loadBootstrap() {
    const data = await api('/api/bootstrap');
    state.today = data.today;
    state.smsMode = data.smsMode;
    state.settings = data.settings;
    state.summary = data.summary;
    state.debts = data.debts;
    state.smsLogs = data.smsLogs;
    renderAll();
  }

  // Filter & Search
  document.getElementById('debtSearchInput').addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderDebtsList();
  });

  document.getElementById('debtFilterChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.debtFilter = chip.dataset.filter;
    document.querySelectorAll('#debtFilterChips .chip').forEach((c) => {
      c.classList.toggle('active', c === chip);
    });
    renderDebtsList();
  });

  // Delegated clicks for debt cards & quick remind
  document.addEventListener('click', async (e) => {
    const remindBtn = e.target.closest('[data-quick-remind]');
    if (remindBtn) {
      e.stopPropagation();
      const id = remindBtn.dataset.quickRemind;
      remindBtn.disabled = true;
      remindBtn.textContent = 'Yuborilmoqda...';
      try {
        const res = await api(`/api/debts/${id}/remind`, { method: 'POST', body: '{}' });
        haptic('medium');
        showSmsPhonePopup(res.smsLog);
        showToast('Eslatma SMS yuborildi!');
        await loadBootstrap();
      } catch (err) {
        showToast(err.message);
      }
      return;
    }

    const card = e.target.closest('[data-debt-id]');
    if (card) {
      openDebtDetail(card.dataset.debtId);
    }
  });

  // New Debt Modal & Live SMS Preview
  const newDebtPhoneEl = document.getElementById('newDebtPhone');
  const newDebtNameEl = document.getElementById('newDebtName');
  const newDebtAmountEl = document.getElementById('newDebtAmount');
  const newDebtItemsEl = document.getElementById('newDebtItems');
  const newDebtDueDateEl = document.getElementById('newDebtDueDate');
  const newDebtSendSmsEl = document.getElementById('newDebtSendSms');

  function updateNewDebtSmsPreview() {
    const box = document.getElementById('newDebtSmsPreviewBox');
    box.style.display = newDebtSendSmsEl.checked ? 'block' : 'none';
    if (!state.settings) return;

    const name = newDebtNameEl.value.trim() || 'Mijoz';
    const rawAmount = Number(newDebtAmountEl.value.replace(/\D/g, '') || 0);
    const totalWithExisting = rawAmount + Number(state.lookupExistingTotal || 0);
    const due = newDebtDueDateEl.value || addDays(state.today, 7);

    const minSms = Number(state.settings.smsRules?.minDebtForSms || 0);
    if (totalWithExisting > 0 && totalWithExisting < minSms) {
      document.getElementById('newDebtSmsPreviewText').textContent = `ℹ️ Jami qarz (${formatSum(
        totalWithExisting
      )}) minimal SMS chegarasidan (${formatSum(minSms)}) kam bo'lgani uchun avtomatik SMS yuborilmaydi.`;
      return;
    }

    const text = (state.settings.templates?.created || '')
      .replace(/\{ism\}/g, name)
      .replace(/\{dokon\}/g, state.settings.storeName)
      .replace(/\{summa\}/g, formatPlainNumber(rawAmount))
      .replace(/\{jami_qarz\}/g, formatPlainNumber(totalWithExisting))
      .replace(/\{muddat\}/g, due)
      .replace(/\{telefon\}/g, state.settings.storePhone);

    document.getElementById('newDebtSmsPreviewText').textContent = text;
  }

  function openNewDebtModal() {
    document.getElementById('newDebtForm').reset();
    state.lookupExistingTotal = 0;
    document.getElementById('customerLookupHint').textContent = '';
    newDebtSendSmsEl.checked = state.settings?.autoSendOnCreate ?? true;
    newDebtDueDateEl.value = addDays(state.today || new Date().toISOString().slice(0, 10), 7);
    updateNewDebtSmsPreview();
    openModal('newDebtModal');
    setTimeout(() => newDebtPhoneEl.focus(), 120);
    haptic('light');
  }

  document.getElementById('openNewDebtBtn').addEventListener('click', openNewDebtModal);
  document.getElementById('fabAddDebt').addEventListener('click', openNewDebtModal);

  let lookupTimeout = null;
  newDebtPhoneEl.addEventListener('input', (e) => {
    e.target.value = formatLocalPhoneInput(e.target.value);
    const digits = e.target.value.replace(/\D/g, '');
    clearTimeout(lookupTimeout);
    if (digits.length === 9) {
      lookupTimeout = setTimeout(async () => {
        try {
          const res = await api(`/api/customers/lookup?phone=998${digits}`);
          const hint = document.getElementById('customerLookupHint');
          if (res.found) {
            state.lookupExistingTotal = Number(res.activeDebtTotal || 0);
            if (!newDebtNameEl.value.trim()) {
              newDebtNameEl.value = res.customerName;
            }
            hint.textContent = `✓ Avvalgi mijoz: ${res.customerName} (joriy qarz: ${formatSum(
              res.activeDebtTotal
            )})`;
            updateNewDebtSmsPreview();
          } else {
            state.lookupExistingTotal = 0;
            hint.textContent = 'Yangi mijoz — bazaga qo‘shiladi';
            updateNewDebtSmsPreview();
          }
        } catch (_) {}
      }, 150);
    } else {
      state.lookupExistingTotal = 0;
      document.getElementById('customerLookupHint').textContent = '';
      updateNewDebtSmsPreview();
    }
  });

  newDebtAmountEl.addEventListener('input', (e) => {
    const digits = e.target.value.replace(/\D/g, '');
    e.target.value = digits ? formatPlainNumber(digits) : '';
    updateNewDebtSmsPreview();
  });

  [newDebtNameEl, newDebtDueDateEl, newDebtSendSmsEl].forEach((el) => {
    el.addEventListener('input', updateNewDebtSmsPreview);
    el.addEventListener('change', updateNewDebtSmsPreview);
  });

  document.getElementById('amountQuickChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-amount]');
    if (!btn) return;
    newDebtAmountEl.value = formatPlainNumber(btn.dataset.amount);
    updateNewDebtSmsPreview();
    haptic('light');
  });

  document.getElementById('dueDateQuickChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-days]');
    if (!btn) return;
    newDebtDueDateEl.value = addDays(state.today, Number(btn.dataset.days));
    updateNewDebtSmsPreview();
    haptic('light');
  });

  document.getElementById('newDebtForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('saveDebtSubmitBtn');
    const digits = newDebtPhoneEl.value.replace(/\D/g, '');
    const amount = Number(newDebtAmountEl.value.replace(/\D/g, ''));

    btn.disabled = true;
    btn.textContent = 'Saqlanmoqda...';
    try {
      const res = await api('/api/debts', {
        method: 'POST',
        body: JSON.stringify({
          phone: `+998${digits}`,
          customerName: newDebtNameEl.value.trim(),
          totalAmount: amount,
          items: newDebtItemsEl.value.trim(),
          dueDate: newDebtDueDateEl.value,
          sendSmsNow: newDebtSendSmsEl.checked,
        }),
      });
      closeModal('newDebtModal');
      haptic('medium');
      if (res.smsLog) {
        showToast('Qarz yozildi va SMS yuborildi!');
        showSmsPhonePopup(res.smsLog);
      } else if (res.skippedReason) {
        showToast(`Qarz yozildi (${res.skippedReason})`);
      } else {
        showToast('Qarz muvaffaqiyatli yozildi!');
      }
      await loadBootstrap();
    } catch (err) {
      showToast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Saqlash va SMS yuborish';
    }
  });

  // Debt Detail Modal
  function openDebtDetail(debtId) {
    const debt = state.debts.find((d) => d.id === debtId);
    if (!debt) return;
    state.selectedDebtId = debtId;

    document.getElementById('detailCustomerName').textContent = debt.customerName;
    const debtSmsLogs = state.smsLogs.filter((l) => l.debtId === debt.id);

    const body = document.getElementById('debtDetailBody');
    body.innerHTML = `
      <div class="detail-summary-box">
        <div class="detail-row"><span>Telefon:</span><strong>${escapeHtml(
          formatPhoneDisplay(debt.phone)
        )}</strong></div>
        <div class="detail-row"><span>Tovarlar:</span><strong>${escapeHtml(debt.items)}</strong></div>
        <div class="detail-row"><span>Jami xarid:</span><strong>${formatSum(debt.totalAmount)}</strong></div>
        <div class="detail-row"><span>To'langan:</span><strong>${formatSum(debt.paidAmount)}</strong></div>
        <div class="detail-row"><span>Qoldiq qarz:</span><strong style="color:var(--danger)">${formatSum(
          debt.remainingAmount
        )}</strong></div>
        <div class="detail-row"><span>Qaytarish muddati:</span><strong>${debt.dueDate}</strong></div>
        <div style="margin-top:4px">${statusBadgeHtml(debt)}</div>
      </div>

      ${
        debt.remainingAmount > 0
          ? `
        <div class="pay-box">
          <div class="detail-section-title">💵 To'lov qabul qilish</div>
          <input type="text" inputmode="numeric" id="payAmountInput" value="${formatPlainNumber(
            debt.remainingAmount
          )}" style="border:1px solid var(--border);background:var(--surface-muted);color:var(--text);border-radius:10px;padding:10px 12px;font-size:14px;" />
          <label class="switch-row" style="padding:2px 0">
            <small>To'lov haqida mijozga SMS chek yuborish</small>
            <input type="checkbox" id="paySendSms" checked />
          </label>
          <div class="pay-actions-row">
            <button class="btn btn-primary btn-sm" id="submitPayBtn" type="button">To'lovni kiritish</button>
            <button class="btn btn-outline btn-sm" id="sendCustomRemindBtn" type="button">📩 SMS eslatma</button>
          </div>
        </div>

        <div class="pay-box">
          <div class="detail-section-title">📅 Muddatni uzaytirish</div>
          <div class="pay-actions-row">
            <input type="date" id="extendDueInput" value="${debt.dueDate}" style="flex:1;border:1px solid var(--border);background:var(--surface-muted);color:var(--text);border-radius:10px;padding:8px 10px;font-size:13px;" />
            <button class="btn btn-outline btn-sm" id="saveDueDateBtn" type="button" style="width:auto">Saqlash</button>
          </div>
        </div>
      `
          : ''
      }

      <div>
        <div class="detail-section-title">🧾 To'lovlar tarixi (${debt.payments?.length || 0})</div>
        ${
          debt.payments && debt.payments.length
            ? debt.payments
                .map(
                  (p) =>
                    `<div class="sms-card" style="padding:9px 11px;margin-top:6px"><div class="detail-row"><strong>${formatSum(
                      p.amount
                    )}</strong><span>${formatDateTime(p.createdAt)}</span></div></div>`
                )
                .join('')
            : `<div class="helper-text">Hali to'lov qilinmagan</div>`
        }
      </div>

      <div>
        <div class="detail-section-title">📩 Ushbu qarz bo'yicha SMSlar (${debtSmsLogs.length})</div>
        <div class="sms-preview-list" style="margin-top:6px">
          ${
            debtSmsLogs.length
              ? debtSmsLogs.map(renderSmsCard).join('')
              : `<div class="helper-text">SMS yuborilmagan</div>`
          }
        </div>
      </div>

      <button class="btn btn-danger btn-sm" id="deleteDebtBtn" type="button">Qarzni o'chirish</button>
    `;

    const payInput = document.getElementById('payAmountInput');
    if (payInput) {
      payInput.addEventListener('input', (e) => {
        const digits = e.target.value.replace(/\D/g, '');
        e.target.value = digits ? formatPlainNumber(digits) : '';
      });
    }

    const submitPayBtn = document.getElementById('submitPayBtn');
    if (submitPayBtn) {
      submitPayBtn.addEventListener('click', async () => {
        const amount = Number((payInput.value || '').replace(/\D/g, ''));
        const sendSmsReceipt = document.getElementById('paySendSms').checked;
        submitPayBtn.disabled = true;
        try {
          const res = await api(`/api/debts/${debt.id}/pay`, {
            method: 'POST',
            body: JSON.stringify({ amount, sendSmsReceipt }),
          });
          haptic('medium');
          showToast("To'lov qabul qilindi!");
          if (res.smsLog) showSmsPhonePopup(res.smsLog);
          await loadBootstrap();
          openDebtDetail(debt.id);
        } catch (err) {
          showToast(err.message);
        } finally {
          submitPayBtn.disabled = false;
        }
      });
    }

    const remindBtn = document.getElementById('sendCustomRemindBtn');
    if (remindBtn) {
      remindBtn.addEventListener('click', async () => {
        remindBtn.disabled = true;
        try {
          const res = await api(`/api/debts/${debt.id}/remind`, { method: 'POST', body: '{}' });
          haptic('medium');
          showSmsPhonePopup(res.smsLog);
          showToast('SMS eslatma yuborildi!');
          await loadBootstrap();
          openDebtDetail(debt.id);
        } catch (err) {
          showToast(err.message);
        } finally {
          remindBtn.disabled = false;
        }
      });
    }

    const saveDueBtn = document.getElementById('saveDueDateBtn');
    if (saveDueBtn) {
      saveDueBtn.addEventListener('click', async () => {
        const dueDate = document.getElementById('extendDueInput').value;
        try {
          await api(`/api/debts/${debt.id}/due-date`, {
            method: 'PUT',
            body: JSON.stringify({ dueDate }),
          });
          showToast('Muddat yangilandi!');
          await loadBootstrap();
          openDebtDetail(debt.id);
        } catch (err) {
          showToast(err.message);
        }
      });
    }

    document.getElementById('deleteDebtBtn').addEventListener('click', async () => {
      try {
        await api(`/api/debts/${debt.id}`, { method: 'DELETE' });
        closeModal('debtDetailModal');
        showToast("Qarz o'chirildi");
        await loadBootstrap();
      } catch (err) {
        showToast(err.message);
      }
    });

    openModal('debtDetailModal');
  }

  // Run Reminders Buttons
  async function triggerReminders(forceOverdue = false) {
    try {
      const res = await api('/api/reminders/run', {
        method: 'POST',
        body: JSON.stringify({ forceOverdue }),
      });
      haptic('medium');
      if (res.sentCount > 0) {
        showToast(`${res.sentCount} ta mijozga eslatma SMS yuborildi!`);
        showSmsPhonePopup(res.logs[0]);
      } else {
        showToast('Hozircha yangi eslatma yuboriladigan qarz topilmadi');
      }
      await loadBootstrap();
    } catch (err) {
      showToast(err.message);
    }
  }

  document.getElementById('runRemindersBtn').addEventListener('click', () => triggerReminders(false));
  document
    .getElementById('testOverdueForceBtn')
    .addEventListener('click', () => triggerReminders(true));

  // Save Settings
  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          storeName: document.getElementById('setStoreName').value.trim(),
          storePhone: document.getElementById('setStorePhone').value.trim(),
          autoSendOnCreate: document.getElementById('setAutoSendOnCreate').checked,
          remindOnDueDate: document.getElementById('setRemindOnDueDate').checked,
          remindBeforeDays: Number(document.getElementById('setRemindBeforeDays').value),
          smsRules: {
            minDebtForSms: Number(document.getElementById('setMinDebtForSms').value || 0),
            highDebtThreshold: Number(document.getElementById('setHighDebtThreshold').value || 500000),
            normalRepeatDays: Number(document.getElementById('setNormalRepeatDays').value),
            highDebtRepeatDays: Number(document.getElementById('setHighDebtRepeatDays').value),
          },
          templates: {
            created: document.getElementById('tplCreated').value,
            overdue: document.getElementById('tplOverdue').value,
            highDebtOverdue: document.getElementById('tplHighDebtOverdue').value,
            paid: document.getElementById('tplPaid').value,
          },
        }),
      });
      haptic('medium');
      showToast('Sozlamalar va SMS qoidalari saqlandi!');
      await loadBootstrap();
    } catch (err) {
      showToast(err.message);
    }
  });

  // Test SMS
  const testSmsPhoneEl = document.getElementById('testSmsPhone');
  testSmsPhoneEl.addEventListener('input', (e) => {
    e.target.value = formatLocalPhoneInput(e.target.value);
  });

  document.getElementById('sendTestSmsBtn').addEventListener('click', async () => {
    const digits = testSmsPhoneEl.value.replace(/\D/g, '');
    const btn = document.getElementById('sendTestSmsBtn');
    btn.disabled = true;
    try {
      const res = await api('/api/sms/test', {
        method: 'POST',
        body: JSON.stringify({ phone: `+998${digits}` }),
      });
      haptic('medium');
      showSmsPhonePopup(res.smsLog);
      showToast(
        res.smsLog.status === 'failed'
          ? `Xatolik: ${res.smsLog.error}`
          : 'Test SMS yuborildi!'
      );
      await loadBootstrap();
    } catch (err) {
      showToast(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  loadBootstrap().catch((err) => {
    showToast(`Yuklashda xatolik: ${err.message}`);
  });
})();
