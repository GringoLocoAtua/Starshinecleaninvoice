/* Starshine Invoice Pro (PWA) */
(() => {
  const LS_KEYS = {
    invoices: "starshine_invoices_v1",
    clients: "starshine_clients_v1",
    nextInv: "starshine_next_invoice_no_v1",
    lastDraft: "starshine_last_draft_v1",
  };

  const $ = (id) => document.getElementById(id);
  const toastEl = () => $("toast");

  function toast(msg, sub = "") {
    const el = toastEl();
    if (!el) return;
    el.innerHTML = `${escapeHtml(msg)}${sub ? `<small>${escapeHtml(sub)}</small>` : ""}`;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2400);
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function loadLS(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function saveLS(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function nowISODate() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function addDaysISO(iso, days) {
    const d = iso ? new Date(iso + "T00:00:00") : new Date();
    d.setDate(d.getDate() + days);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function nextInvoiceRef() {
    const n = Number(localStorage.getItem(LS_KEYS.nextInv) || "1");
    localStorage.setItem(LS_KEYS.nextInv, String(n + 1));
    return `INV-${String(n).padStart(6, "0")}`;
  }

  function money(n) {
    const num = Number(n || 0);
    return num.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
  }

  // --- Mobile viewport stability (iOS address bar + no random zoom) ---
  function applyVH() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty("--vh", `${vh}px`);
  }
  window.addEventListener("resize", () => {
    clearTimeout(applyVH._t);
    applyVH._t = setTimeout(applyVH, 80);
  });
  applyVH();

  // --- Service Worker ---
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    });
  }

  // --- State ---
  let invoices = loadLS(LS_KEYS.invoices, []);
  let clients = loadLS(LS_KEYS.clients, []);
  let draft = loadLS(LS_KEYS.lastDraft, null);

  // Expose minimal globals used by HTML
  window.showDashboard = showDashboard;
  window.showNewInvoice = showNewInvoice;
  window.showClients = showClients;
  window.loadHistory = loadHistory;

  window.addRow = addRow;
  window.calculate = calculate;
  window.saveInvoice = saveInvoice;
  window.previewInvoice = previewInvoice;

  window.clearAllInvoices = clearAllInvoices;

  window.applySelectedClient = applySelectedClient;
  window.saveClientFromInvoice = saveClientFromInvoice;
  window.clearClientFields = clearClientFields;

  window.loadClientsUI = loadClientsUI;
  window.clearClientForm = clearClientForm;
  window.saveClient = saveClient;
  window.useClientFormForInvoice = useClientFormForInvoice;
  window.deleteClientFromForm = deleteClientFromForm;

  // For preview actions
  window.backFromPreview = backFromPreview;
  window.exportPdf = exportPdf;

  // --- Init ---
  document.addEventListener("DOMContentLoaded", () => {
    // If tabs exist, default to dashboard
    setActiveNav("navDash");

    // seed new invoice fields
    resetInvoiceForm(true);

    // restore draft (optional)
    if (draft && $("clientName") && $("itemsTable")) {
      try {
        hydrateInvoiceForm(draft);
      } catch {}
    }

    loadClientsDropdown();
    loadHistory();
  });

  // --- Nav helpers ---
  function setActiveNav(activeId) {
    ["navDash", "navNew", "navClients"].forEach((id) => {
      const b = $(id);
      if (!b) return;
      b.classList.toggle("active", id === activeId);
    });
  }

  function showOnly(sectionId) {
    const ids = ["dashboard", "newInvoice", "clients", "previewSection"];
    ids.forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.classList.toggle("hidden", id !== sectionId);
    });
  }

  function showDashboard() {
    setActiveNav("navDash");
    showOnly("dashboard");
    loadHistory();
  }

  function showNewInvoice() {
    setActiveNav("navNew");
    showOnly("newInvoice");
    // ensure at least one row
    if ($("itemsTable") && $("itemsTable").querySelectorAll("tbody tr").length === 0) addRow();
  }

  function showClients() {
    setActiveNav("navClients");
    showOnly("clients");
    loadClientsUI();
  }

  // --- Clients ---
  function loadClientsDropdown() {
    const sel = $("savedClientSelect");
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">— Select saved client —</option>`;
    clients
      .slice()
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = `${c.name || "Unnamed"}${c.phone ? " — " + c.phone : ""}`;
        sel.appendChild(opt);
      });
    if (current) sel.value = current;
  }

  function applySelectedClient() {
    const sel = $("savedClientSelect");
    if (!sel || !sel.value) return;
    const c = clients.find((x) => x.id === sel.value);
    if (!c) return;
    $("clientName").value = c.name || "";
    $("clientAddress").value = c.address || "";
    $("clientPhone").value = c.phone || "";
    $("clientEmail").value = c.email || "";
    $("clientAbn").value = c.abn || "";
    toast("Client applied");
  }

  function normalizePhone(p) {
    return String(p || "").replace(/[^\d+]/g, "").trim();
  }

  function saveClientFromInvoice() {
    const name = $("clientName")?.value?.trim() || "";
    const address = $("clientAddress")?.value?.trim() || "";
    const phone = normalizePhone($("clientPhone")?.value);
    const email = $("clientEmail")?.value?.trim() || "";
    const abn = $("clientAbn")?.value?.trim() || "";

    if (!name) return toast("Client name required");
    const key = phone || email || (name + "|" + address);

    let existing = null;
    if (phone) existing = clients.find((c) => normalizePhone(c.phone) === phone);
    if (!existing && email) existing = clients.find((c) => (c.email || "").toLowerCase() === email.toLowerCase());
    if (!existing) existing = clients.find((c) => (c.key || "") === key);

    const obj = existing || { id: crypto.randomUUID?.() || String(Date.now()), createdAt: Date.now() };
    obj.name = name;
    obj.address = address;
    obj.phone = phone;
    obj.email = email;
    obj.abn = abn;
    obj.key = key;
    obj.updatedAt = Date.now();

    if (!existing) clients.unshift(obj);

    saveLS(LS_KEYS.clients, clients);
    loadClientsDropdown();
    toast(existing ? "Client updated" : "Client saved");
  }

  function clearClientFields() {
    ["clientName", "clientAddress", "clientPhone", "clientEmail", "clientAbn"].forEach((id) => {
      const el = $(id);
      if (el) el.value = "";
    });
    const sel = $("savedClientSelect");
    if (sel) sel.value = "";
    toast("Cleared");
  }

  function loadClientsUI() {
    const list = $("clientsList");
    if (!list) return;

    const q = ($("clientsSearchBox")?.value || "").trim().toLowerCase();

    const filtered = clients.filter((c) => {
      const hay = `${c.name || ""} ${c.phone || ""} ${c.address || ""} ${c.email || ""} ${c.abn || ""}`.toLowerCase();
      return !q || hay.includes(q);
    });

    list.innerHTML = "";
    if (filtered.length === 0) {
      list.innerHTML = `<div class="muted" style="padding:10px;">No clients yet.</div>`;
      return;
    }

    filtered.forEach((c) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-left">
          <div class="title">${escapeHtml(c.name || "Unnamed")}</div>
          <div class="meta">${escapeHtml(c.address || "")}</div>
          <div class="meta">${escapeHtml(c.phone || "")}${c.email ? " • " + escapeHtml(c.email) : ""}${c.abn ? " • ABN " + escapeHtml(c.abn) : ""}</div>
        </div>
        <div class="card-right">
          <button class="btn ghost" data-act="edit">Edit</button>
          <button class="btn" data-act="invoice">Invoice</button>
        </div>
      `;
      card.querySelector('[data-act="edit"]').onclick = () => fillClientForm(c);
      card.querySelector('[data-act="invoice"]').onclick = () => {
        fillClientForm(c);
        useClientFormForInvoice();
      };
      list.appendChild(card);
    });
  }

  function fillClientForm(c) {
    $("c_id").value = c.id || "";
    $("c_name").value = c.name || "";
    $("c_address").value = c.address || "";
    $("c_phone").value = c.phone || "";
    $("c_email").value = c.email || "";
    $("c_abn").value = c.abn || "";
  }

  function clearClientForm() {
    ["c_id", "c_name", "c_address", "c_phone", "c_email", "c_abn"].forEach((id) => {
      const el = $(id);
      if (el) el.value = "";
    });
    toast("New client");
  }

  function saveClient() {
    const id = $("c_id").value || (crypto.randomUUID?.() || String(Date.now()));
    const name = $("c_name").value.trim();
    const address = $("c_address").value.trim();
    const phone = normalizePhone($("c_phone").value);
    const email = $("c_email").value.trim();
    const abn = $("c_abn").value.trim();
    if (!name) return toast("Client name required");

    let existing = clients.find((c) => c.id === id);
    if (!existing) {
      existing = { id, createdAt: Date.now() };
      clients.unshift(existing);
    }
    existing.name = name;
    existing.address = address;
    existing.phone = phone;
    existing.email = email;
    existing.abn = abn;
    existing.updatedAt = Date.now();
    existing.key = phone || email || (name + "|" + address);

    saveLS(LS_KEYS.clients, clients);
    loadClientsUI();
    loadClientsDropdown();
    toast("Client saved");
  }

  function useClientFormForInvoice() {
    const name = $("c_name")?.value?.trim() || "";
    if (!name) return toast("Pick a client first");
    $("clientName").value = name;
    $("clientAddress").value = $("c_address").value.trim();
    $("clientPhone").value = $("c_phone").value.trim();
    $("clientEmail").value = $("c_email").value.trim();
    $("clientAbn").value = $("c_abn").value.trim();

    // select in dropdown if matches
    const phone = normalizePhone($("c_phone").value);
    const match = clients.find((c) => (c.id === $("c_id").value) || (phone && normalizePhone(c.phone) === phone));
    if (match && $("savedClientSelect")) $("savedClientSelect").value = match.id;

    showNewInvoice();
    toast("Client loaded into invoice");
  }

  function deleteClientFromForm() {
    const id = $("c_id").value;
    if (!id) return toast("No client selected");
    clients = clients.filter((c) => c.id !== id);
    saveLS(LS_KEYS.clients, clients);
    clearClientForm();
    loadClientsUI();
    loadClientsDropdown();
    toast("Client deleted");
  }

  // --- Invoice form ---
  function resetInvoiceForm(keepDraft = false) {
    if ($("invoiceNo")) $("invoiceNo").value = nextInvoiceRef();
    if ($("invoiceDate")) $("invoiceDate").value = nowISODate();
    if ($("dueDate")) $("dueDate").value = addDaysISO(nowISODate(), 7);
    if ($("gstToggle")) $("gstToggle").checked = false;

    if (!keepDraft) {
      clearClientFields();
      clearItems();
    } else {
      // ensure items exists
      if ($("itemsTable") && $("itemsTable").querySelectorAll("tbody tr").length === 0) addRow();
    }

    calculate();
  }

  function clearItems() {
    const tbody = $("itemsTable")?.querySelector("tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    addRow();
  }

  function hydrateInvoiceForm(inv) {
    $("invoiceNo").value = inv.ref || inv.invoiceNo || nextInvoiceRef();
    $("invoiceDate").value = inv.invoiceDate || nowISODate();
    $("dueDate").value = inv.dueDate || addDaysISO(nowISODate(), 7);

    $("clientName").value = inv.client?.name || "";
    $("clientAddress").value = inv.client?.address || "";
    $("clientPhone").value = inv.client?.phone || "";
    $("clientEmail").value = inv.client?.email || "";
    $("clientAbn").value = inv.client?.abn || "";
    $("gstToggle").checked = !!inv.gst;

    const tbody = $("itemsTable")?.querySelector("tbody");
    if (!tbody) return;

    tbody.innerHTML = "";
    (inv.items || []).forEach((it) => addRow(it));
    if ((inv.items || []).length === 0) addRow();

    calculate();
  }

  function addRow(prefill = null) {
    const tbody = $("itemsTable")?.querySelector("tbody");
    if (!tbody) return;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input class="it-desc" placeholder="e.g. End of lease clean" value="${escapeHtml(prefill?.desc || "")}"></td>
      <td><input class="it-price" inputmode="decimal" placeholder="0.00" value="${prefill?.price ?? ""}"></td>
      <td><input class="it-qty" inputmode="decimal" placeholder="1" value="${prefill?.qty ?? "1"}"></td>
      <td class="amount it-amount">$0.00</td>
      <td><button class="btn danger" type="button">✕</button></td>
    `;
    tr.querySelector(".btn.danger").onclick = () => {
      tr.remove();
      calculate();
    };

    // live calc
    ["input", "change"].forEach((evt) => {
      tr.querySelector(".it-desc").addEventListener(evt, saveDraftDebounced);
      tr.querySelector(".it-price").addEventListener(evt, () => { calculate(); saveDraftDebounced(); });
      tr.querySelector(".it-qty").addEventListener(evt, () => { calculate(); saveDraftDebounced(); });
    });

    tbody.appendChild(tr);
    calculate();
  }

  function readItems() {
    const rows = Array.from($("itemsTable")?.querySelectorAll("tbody tr") || []);
    const items = rows.map((tr) => {
      const desc = tr.querySelector(".it-desc")?.value?.trim() || "";
      const price = Number(String(tr.querySelector(".it-price")?.value || "").replace(/[^0-9.\-]/g, "")) || 0;
      const qty = Number(String(tr.querySelector(".it-qty")?.value || "").replace(/[^0-9.\-]/g, "")) || 0;
      return { desc, price, qty };
    }).filter((it) => it.desc || it.price || it.qty);
    return items;
  }

  function calculate() {
    const items = readItems();
    const gstOn = !!$("gstToggle")?.checked;

    let sub = 0;
    const rows = Array.from($("itemsTable")?.querySelectorAll("tbody tr") || []);
    rows.forEach((tr, idx) => {
      const price = Number(String(tr.querySelector(".it-price")?.value || "").replace(/[^0-9.\-]/g, "")) || 0;
      const qty = Number(String(tr.querySelector(".it-qty")?.value || "").replace(/[^0-9.\-]/g, "")) || 0;
      const amt = price * qty;
      if (tr.querySelector(".it-amount")) tr.querySelector(".it-amount").textContent = money(amt);
      sub += amt;
    });

    const gst = gstOn ? sub * 0.10 : 0;
    const total = sub + gst;

    const summary = $("summary");
    if (summary) {
      summary.innerHTML = `
        <div><span class="muted">Subtotal</span> — ${money(sub)}</div>
        <div><span class="muted">GST</span> — ${money(gst)}</div>
        <div style="margin-top:6px;font-size:16px;"><span class="muted">Total</span> — ${money(total)}</div>
      `;
    }

    saveDraftDebounced();
  }

  const saveDraftDebounced = (() => {
    let t = null;
    return () => {
      clearTimeout(t);
      t = setTimeout(() => {
        try {
          const inv = collectInvoiceFromForm(false);
          saveLS(LS_KEYS.lastDraft, inv);
        } catch {}
      }, 250);
    };
  })();

  function collectInvoiceFromForm(requireClient = true) {
    const ref = $("invoiceNo")?.value?.trim() || nextInvoiceRef();
    const invoiceDate = $("invoiceDate")?.value || nowISODate();
    const dueDate = $("dueDate")?.value || addDaysISO(invoiceDate, 7);

    const client = {
      name: $("clientName")?.value?.trim() || "",
      address: $("clientAddress")?.value?.trim() || "",
      phone: $("clientPhone")?.value?.trim() || "",
      email: $("clientEmail")?.value?.trim() || "",
      abn: $("clientAbn")?.value?.trim() || "",
    };

    if (requireClient && !client.name) throw new Error("Client name required");

    const items = readItems();
    if (requireClient && items.length === 0) throw new Error("Add at least 1 line item");

    const gst = !!$("gstToggle")?.checked;
    const sub = items.reduce((a, it) => a + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
    const gstAmt = gst ? sub * 0.10 : 0;
    const total = sub + gstAmt;

    return {
      id: crypto.randomUUID?.() || String(Date.now()),
      ref,
      invoiceDate,
      dueDate,
      client,
      items,
      gst,
      totals: { sub, gst: gstAmt, total },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  function saveInvoice() {
    let inv;
    try {
      inv = collectInvoiceFromForm(true);
    } catch (e) {
      return toast("Can't save", e.message || "Missing fields");
    }

    // Upsert by ref (so user can re-save same invoice number if they want)
    const idx = invoices.findIndex((x) => x.ref === inv.ref);
    if (idx >= 0) {
      inv.id = invoices[idx].id;
      inv.createdAt = invoices[idx].createdAt;
      invoices[idx] = inv;
    } else {
      invoices.unshift(inv);
    }

    saveLS(LS_KEYS.invoices, invoices);
    toast("Invoice saved", inv.ref);
    loadHistory();
  }

  function clearAllInvoices() {
    if (!confirm("Delete all invoices stored on this device?")) return;
    invoices = [];
    saveLS(LS_KEYS.invoices, invoices);
    toast("Invoices cleared");
    loadHistory();
  }

  // --- History ---
  function loadHistory() {
    const list = $("historyList");
    if (!list) return;

    invoices = loadLS(LS_KEYS.invoices, []);
    const q = ($("searchBox")?.value || "").trim().toLowerCase();

    const filtered = invoices.filter((inv) => {
      const hay = `${inv.ref || ""} ${inv.client?.name || ""} ${inv.client?.phone || ""} ${inv.client?.address || ""}`.toLowerCase();
      return !q || hay.includes(q);
    });

    list.innerHTML = "";
    if (filtered.length === 0) {
      list.innerHTML = `<div class="muted" style="padding:10px;">No invoices yet.</div>`;
      return;
    }

    filtered.forEach((inv) => {
      const card = document.createElement("div");
      card.className = "card";
      const total = inv.totals?.total ?? 0;

      card.innerHTML = `
        <div class="card-left">
          <div class="title">${escapeHtml(inv.ref || "Invoice")}${inv.client?.name ? ` — ${escapeHtml(inv.client.name)}` : ""}</div>
          <div class="meta">${escapeHtml(inv.client?.address || "")}</div>
          <div class="meta">${escapeHtml(inv.invoiceDate || "")}${inv.client?.phone ? " • " + escapeHtml(inv.client.phone) : ""}</div>
        </div>
        <div class="card-right">
          <div class="pill">${money(total)}</div>
          <button class="btn" data-act="view">View</button>
          <button class="btn danger" data-act="del">Delete</button>
        </div>
      `;

      card.querySelector('[data-act="view"]').onclick = () => {
        hydrateInvoiceForm(inv);
        previewInvoice();
      };
      card.querySelector('[data-act="del"]').onclick = () => {
        if (!confirm(`Delete ${inv.ref}?`)) return;
        invoices = invoices.filter((x) => x.id !== inv.id);
        saveLS(LS_KEYS.invoices, invoices);
        loadHistory();
        toast("Deleted", inv.ref);
      };

      list.appendChild(card);
    });
  }

  // --- Preview + PDF ---
  function previewInvoice() {
    let inv;
    try {
      inv = collectInvoiceFromForm(true);
    } catch (e) {
      return toast("Can't preview", e.message || "Missing fields");
    }

    const section = $("previewSection");
    if (!section) return;

    // Build preview HTML
    const rows = inv.items.map((it) => {
      const amt = (Number(it.price) || 0) * (Number(it.qty) || 0);
      return `
        <tr>
          <td>${escapeHtml(it.desc)}</td>
          <td style="text-align:right;">${money(it.price)}</td>
          <td style="text-align:right;">${escapeHtml(it.qty)}</td>
          <td style="text-align:right;">${money(amt)}</td>
        </tr>
      `;
    }).join("");

    const gstRow = inv.gst ? `
      <tr>
        <td colspan="3" style="text-align:right;font-weight:800;">GST (10%)</td>
        <td style="text-align:right;font-weight:900;">${money(inv.totals.gst)}</td>
      </tr>` : "";

    section.innerHTML = `
      <div class="invoice-wrap">
        <div style="display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap;align-items:flex-start;">
          <div style="display:flex;gap:12px;align-items:center;">
            <img src="./assets/logo.png" alt="Starshine" style="width:44px;height:44px;border-radius:12px;border:1px solid #e6e6e6;object-fit:cover;" />
            <div>
              <div style="font-weight:950;font-size:18px;line-height:1.1;">Starshine Clean</div>
              <div style="font-size:12px;color:#4b5563;margin-top:2px;">Starshine Invoice Pro</div>
            </div>
          </div>
          <div style="text-align:right;min-width:200px;">
            <div style="font-weight:980;font-size:22px;">INVOICE</div>
            <div style="font-size:12px;color:#4b5563;margin-top:4px;">
              <div><b>${escapeHtml(inv.ref)}</b></div>
              <div>Date: ${escapeHtml(inv.invoiceDate)}</div>
              <div>Due: ${escapeHtml(inv.dueDate)}</div>
            </div>
          </div>
        </div>

        <hr style="border:0;border-top:1px solid #eee;margin:18px 0;" />

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div>
            <div style="font-weight:950;margin-bottom:6px;">Bill To</div>
            <div style="font-size:13px;line-height:1.45;">
              <div style="font-weight:900;">${escapeHtml(inv.client.name)}</div>
              <div>${escapeHtml(inv.client.address)}</div>
              <div>${escapeHtml(inv.client.phone)}</div>
              ${inv.client.email ? `<div>${escapeHtml(inv.client.email)}</div>` : ""}
              ${inv.client.abn ? `<div>ABN: ${escapeHtml(inv.client.abn)}</div>` : ""}
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:950;margin-bottom:6px;">Pay To</div>
            <div style="font-size:13px;line-height:1.45;">
              <div><b>Account name:</b> Starshine Clean</div>
              <div><b>BSB:</b> 014111</div>
              <div><b>Account:</b> 123456789</div>
              <div style="color:#4b5563;margin-top:6px;">(Edit these in your file later.)</div>
            </div>
          </div>
        </div>

        <table style="width:100%;border-collapse:collapse;margin-top:18px;">
          <thead>
            <tr>
              <th style="text-align:left;border-bottom:1px solid #eee;padding:10px 6px;">Description</th>
              <th style="text-align:right;border-bottom:1px solid #eee;padding:10px 6px;">Price</th>
              <th style="text-align:right;border-bottom:1px solid #eee;padding:10px 6px;">Qty</th>
              <th style="text-align:right;border-bottom:1px solid #eee;padding:10px 6px;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            <tr>
              <td colspan="3" style="text-align:right;font-weight:800;padding:10px 6px;border-top:1px solid #eee;">Subtotal</td>
              <td style="text-align:right;font-weight:900;padding:10px 6px;border-top:1px solid #eee;">${money(inv.totals.sub)}</td>
            </tr>
            ${gstRow}
            <tr>
              <td colspan="3" style="text-align:right;font-weight:950;padding:10px 6px;border-top:2px solid #111;">Total</td>
              <td style="text-align:right;font-weight:950;padding:10px 6px;border-top:2px solid #111;">${money(inv.totals.total)}</td>
            </tr>
          </tbody>
        </table>

        <div style="margin-top:18px;font-size:12px;color:#4b5563;">
          Thank you for your business.
        </div>
      </div>

      <div class="preview-actions" style="display:flex;justify-content:flex-end;gap:10px;margin-top:12px;">
        <button class="btn" type="button" onclick="backFromPreview()">Back</button>
        <button class="btn primary" type="button" onclick="exportPdf()">Download PDF</button>
      </div>
    `;

    showOnly("previewSection");
    // keep nav highlight on New Invoice
    setActiveNav("navNew");
    toast("Preview ready", "Tap Download PDF");
  }

  function backFromPreview() {
    showNewInvoice();
  }

  async function exportPdf() {
    const wrap = document.querySelector("#previewSection .invoice-wrap");
    if (!wrap) return toast("Open preview first");

    // Prefer real PDF generation (works on iPhone)
    const hasCanvas = typeof window.html2canvas === "function";
    const hasJsPDF = !!(window.jspdf && window.jspdf.jsPDF);

    if (!hasCanvas || !hasJsPDF) {
      // Last resort: print dialog (may fail in iOS standalone)
      toast("Loading PDF tools…", "If offline first-run, reconnect once.");
      try { window.print(); } catch {}
      return;
    }

    toast("Building PDF…");

    const canvas = await window.html2canvas(wrap, {
      scale: Math.min(2, window.devicePixelRatio || 2),
      useCORS: true,
      backgroundColor: "#ffffff",
      windowWidth: wrap.scrollWidth,
      scrollX: 0,
      scrollY: -window.scrollY,
    });

    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    const { jsPDF } = window.jspdf;

    const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    // Convert px to mm based on canvas dimensions
    const imgProps = pdf.getImageProperties(imgData);
    const imgW = pageW;
    const imgH = (imgProps.height * imgW) / imgProps.width;

    pdf.addImage(imgData, "JPEG", 0, 0, imgW, imgH);

    if (imgH > pageH) {
      const pages = Math.ceil(imgH / pageH);
      for (let i = 1; i < pages; i++) {
        pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, -i * pageH, imgW, imgH);
      }
    }

    const ref = ($("invoiceNo")?.value || "invoice").replace(/[^\w\-]+/g, "_");
    const filename = `${ref}.pdf`;
    const blob = pdf.output("blob");

    // Share on iOS (best UX)
    try {
      const file = new File([blob], filename, { type: "application/pdf" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        toast("Shared", filename);
        return;
      }
    } catch {}

    // Fallback: open + download
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    // iOS often ignores download attribute — opening the blob works.
    setTimeout(() => window.open(url, "_blank"), 150);
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    toast("PDF ready", filename);
  }
})();
