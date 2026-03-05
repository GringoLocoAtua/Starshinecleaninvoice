/* Starshine Invoice Pro — Apple UI Renderer (DOM-driven)
   - Matches your Apple “update screen” index.html
   - Dashboard / New Invoice / Clients
   - LocalStorage: invoices, clients, invoiceCounter, settings
   - Export PDF uses Electron preload API: window.starshineAPI.exportPDF()
     (no window.print => no blank PDFs)
*/

(function () {
  const LS = {
    invoices: "invoices",
    clients: "clients",
    invoiceCounter: "invoiceCounter",
    settings: "settings",
  };

  const DEFAULT_SETTINGS = {
    businessName: "Starshine Cleaning Services",
    businessABN: "55146340682",
    businessPhone: "",
    businessEmail: "",
    businessAddress1: "42 Bayswater Rd",
    businessAddress2: "Rushcutters Bay NSW 2011",
    businessAddress3: "Australia",
    payAccountName: "Karla Diaz Toledo",
    payAccountNumber: "167592159",
    payBankName: "ANZ Plus",
    payBSB: "014111",
  };

  let invoices = [];
  let clients = [];
  let settings = { ...DEFAULT_SETTINGS };
  let currentPreviewInvoice = null;

  // ---------- utils ----------
  function $(id) {
    return document.getElementById(id);
  }

  function safeJSONParse(raw, fallback) {
    try {
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function loadState() {
    invoices = safeJSONParse(localStorage.getItem(LS.invoices), []);
    clients = safeJSONParse(localStorage.getItem(LS.clients), []);
    const s = safeJSONParse(localStorage.getItem(LS.settings), null);
    if (s && typeof s === "object") settings = { ...DEFAULT_SETTINGS, ...s };

    // legacy: if some older key existed, you can add migration here later.
    if (!Array.isArray(invoices)) invoices = [];
    if (!Array.isArray(clients)) clients = [];
  }

  function saveState() {
    localStorage.setItem(LS.invoices, JSON.stringify(invoices));
    localStorage.setItem(LS.clients, JSON.stringify(clients));
    localStorage.setItem(LS.settings, JSON.stringify(settings));
  }

  function toast(title, detail = "") {
    const t = $("toast");
    if (!t) return;
    t.innerHTML = `${escapeHtml(title)}${detail ? `<small>${escapeHtml(detail)}</small>` : ""}`;
    t.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function money(n) {
    const x = Number(n);
    if (!isFinite(x)) return "0.00";
    return x.toFixed(2);
  }

  function parseMoney(v) {
    const x = Number(String(v || "").replace(/[^0-9.\-]/g, ""));
    return isFinite(x) ? x : 0;
  }

  function parseQty(v) {
    const x = Number(String(v || "").replace(/[^0-9.\-]/g, ""));
    return isFinite(x) ? x : 0;
  }

  function todayDDMMYYYY() {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = String(d.getFullYear());
    return `${dd}/${mm}/${yyyy}`;
  }

  function addDaysDDMMYYYY(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = String(d.getFullYear());
    return `${dd}/${mm}/${yyyy}`;
  }

  function getInvoiceCounter() {
    const raw = localStorage.getItem(LS.invoiceCounter);
    const n = parseInt(raw || "1200", 10);
    return Number.isFinite(n) ? n : 1200;
  }

  function setInvoiceCounter(n) {
    const nn = Number(n);
    if (!Number.isFinite(nn)) return;
    localStorage.setItem(LS.invoiceCounter, String(nn));
  }

  function setActiveNav(which) {
    $("navDash")?.classList.toggle("active", which === "dash");
    $("navNew")?.classList.toggle("active", which === "new");
    $("navClients")?.classList.toggle("active", which === "clients");
  }

  function showOnly(sectionId) {
    const ids = ["dashboard", "newInvoice", "clients", "previewSection"];
    ids.forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.classList.toggle("hidden", id !== sectionId);
    });
  }

  // ---------- invoice form ----------
  function ensureInvoiceDefaults() {
    $("invoiceNo").value = String(getInvoiceCounter());
    $("invoiceDate").value = $("invoiceDate").value || todayDDMMYYYY();
    $("dueDate").value = $("dueDate").value || addDaysDDMMYYYY(7);
    if ($("gstToggle").checked === false && $("gstToggle").dataset.init !== "1") {
      $("gstToggle").checked = true;
      $("gstToggle").dataset.init = "1";
    }
  }

  function clearClientFields() {
    $("clientName").value = "";
    $("clientAddress").value = "";
    $("clientPhone").value = "";
    $("clientEmail").value = "";
    $("clientAbn").value = "";
    $("savedClientSelect").value = "";
    toast("Client cleared");
  }

  function addRow(prefill = null) {
    const tbody = $("itemsTable").querySelector("tbody");
    const tr = document.createElement("tr");

    const desc = document.createElement("input");
    desc.value = prefill?.desc ?? "General Clean";
    desc.placeholder = "Description";
    desc.addEventListener("input", calculate);

    const price = document.createElement("input");
    price.value = prefill?.price != null ? String(prefill.price) : "0";
    price.placeholder = "0";
    price.addEventListener("input", calculate);

    const qty = document.createElement("input");
    qty.value = prefill?.qty != null ? String(prefill.qty) : "1";
    qty.placeholder = "1";
    qty.addEventListener("input", calculate);

    const amountTd = document.createElement("td");
    amountTd.className = "amount";
    amountTd.textContent = "0.00";

    const delBtn = document.createElement("button");
    delBtn.className = "btn danger";
    delBtn.style.padding = "8px 12px";
    delBtn.textContent = "X";
    delBtn.addEventListener("click", () => {
      tr.remove();
      calculate();
    });

    const td1 = document.createElement("td");
    const td2 = document.createElement("td");
    const td3 = document.createElement("td");
    const td5 = document.createElement("td");

    td1.appendChild(desc);
    td2.appendChild(price);
    td3.appendChild(qty);
    td5.appendChild(delBtn);

    tr.appendChild(td1);
    tr.appendChild(td2);
    tr.appendChild(td3);
    tr.appendChild(amountTd);
    tr.appendChild(td5);

    tbody.appendChild(tr);
    calculate();
  }

  function getItemsFromTable() {
    const rows = Array.from($("itemsTable").querySelector("tbody").querySelectorAll("tr"));
    return rows.map((tr) => {
      const inputs = tr.querySelectorAll("input");
      const desc = (inputs[0]?.value || "").trim() || "—";
      const price = parseMoney(inputs[1]?.value);
      const qty = parseQty(inputs[2]?.value);
      return { desc, price, qty };
    });
  }

  function calculate() {
    const rows = Array.from($("itemsTable").querySelector("tbody").querySelectorAll("tr"));
    let subtotal = 0;

    rows.forEach((tr) => {
      const inputs = tr.querySelectorAll("input");
      const price = parseMoney(inputs[1]?.value);
      const qty = parseQty(inputs[2]?.value);
      const amt = price * qty;
      subtotal += amt;

      const amtTd = tr.querySelector("td.amount");
      if (amtTd) amtTd.textContent = money(amt);
    });

    const gstOn = !!$("gstToggle").checked;
    const gst = gstOn ? subtotal * 0.1 : 0;
    const total = subtotal + gst;

    $("summary").innerHTML =
      `Subtotal: <span class="muted">$${money(subtotal)}</span>` +
      ` &nbsp; | &nbsp; GST: <span class="muted">$${money(gst)}</span>` +
      ` &nbsp; | &nbsp; Total: <span>$${money(total)}</span>`;

    return { subtotal, gst, total };
  }

  function getInvoiceFromForm() {
    const invoiceNo = String($("invoiceNo").value || "").trim();
    const invoiceDate = String($("invoiceDate").value || "").trim();
    const dueDate = String($("dueDate").value || "").trim();

    const clientName = String($("clientName").value || "").trim();
    const clientAddress = String($("clientAddress").value || "").trim();
    const clientPhone = String($("clientPhone").value || "").trim();
    const clientEmail = String($("clientEmail").value || "").trim();
    const clientAbn = String($("clientAbn").value || "").trim();

    const items = getItemsFromTable();
    const totals = calculate();

    return {
      invoiceNo,
      invoiceDate,
      dueDate,
      clientName,
      clientAddress,
      clientPhone,
      clientEmail,
      clientABN: clientAbn, // matches main.js template field
      clientAbn, // keep legacy alias too
      gstEnabled: !!$("gstToggle").checked,
      items,
      subtotal: totals.subtotal,
      gst: totals.gst,
      total: totals.total,
      updatedAt: new Date().toISOString(),
    };
  }

  function validateInvoice(inv) {
    if (!inv.invoiceNo) return "Invoice number missing.";
    if (!inv.clientName) return "Client name required.";
    if (!inv.clientAddress) return "Client address required.";
    if (!inv.items || inv.items.length === 0) return "Add at least one line item.";
    return "";
  }

  function saveInvoice() {
    const inv = getInvoiceFromForm();
    const err = validateInvoice(inv);
    if (err) return toast("Can't save invoice", err);

    const idx = invoices.findIndex((x) => String(x.invoiceNo) === String(inv.invoiceNo));
    if (idx >= 0) invoices[idx] = { ...invoices[idx], ...inv };
    else invoices.unshift({ ...inv, createdAt: new Date().toISOString() });

    const n = parseInt(inv.invoiceNo, 10);
    if (Number.isFinite(n)) setInvoiceCounter(Math.max(getInvoiceCounter(), n + 1));
    $("invoiceNo").value = String(getInvoiceCounter());

    saveState();
    toast("Invoice saved", `#${inv.invoiceNo} — $${money(inv.total)}`);
    showDashboard();
  }

  function clearAllInvoices() {
    if (!confirm("Clear ALL saved invoices?")) return;
    invoices = [];
    saveState();
    loadHistory();
    toast("Invoices cleared");
  }

  // ---------- dashboard ----------
  function loadHistory() {
    const q = String($("searchBox").value || "").trim().toLowerCase();
    const list = $("historyList");
    list.innerHTML = "";

    const filtered = invoices
      .slice()
      .sort((a, b) => Number(b.invoiceNo || 0) - Number(a.invoiceNo || 0))
      .filter((inv) => {
        if (!q) return true;
        const blob = [
          inv.invoiceNo,
          inv.clientName,
          inv.clientPhone,
          inv.clientEmail,
          inv.clientAddress,
        ]
          .join(" ")
          .toLowerCase();
        return blob.includes(q);
      });

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.style.fontWeight = "850";
      empty.textContent = "No invoices saved yet.";
      list.appendChild(empty);
      return;
    }

    filtered.forEach((inv) => {
      const card = document.createElement("div");
      card.className = "card";

      const left = document.createElement("div");
      left.className = "card-left";
      left.innerHTML = `
        <div class="title">#${escapeHtml(inv.invoiceNo)} — ${escapeHtml(inv.clientName || "Client")}</div>
        <div class="meta">${escapeHtml(inv.invoiceDate || "")} → Due ${escapeHtml(inv.dueDate || "")}</div>
      `;

      const right = document.createElement("div");
      right.className = "card-right";

      const totalPill = document.createElement("div");
      totalPill.className = "pill";
      totalPill.textContent = `$${money(inv.total ?? 0)}`;

      const openBtn = document.createElement("button");
      openBtn.className = "btn";
      openBtn.textContent = "Open / Preview";
      openBtn.onclick = () => openInvoice(inv.invoiceNo);

      const pdfBtn = document.createElement("button");
      pdfBtn.className = "btn primary";
      pdfBtn.textContent = "Export PDF";
      pdfBtn.onclick = () => exportPDF(inv);

      const delBtn = document.createElement("button");
      delBtn.className = "btn danger";
      delBtn.textContent = "Delete";
      delBtn.onclick = () => {
        if (!confirm(`Delete invoice #${inv.invoiceNo}?`)) return;
        invoices = invoices.filter((x) => String(x.invoiceNo) !== String(inv.invoiceNo));
        saveState();
        loadHistory();
        toast("Invoice deleted", `#${inv.invoiceNo}`);
      };

      right.appendChild(totalPill);
      right.appendChild(openBtn);
      right.appendChild(pdfBtn);
      right.appendChild(delBtn);

      card.appendChild(left);
      card.appendChild(right);
      list.appendChild(card);
    });
  }

  function openInvoice(invoiceNo) {
    const inv = invoices.find((x) => String(x.invoiceNo) === String(invoiceNo));
    if (!inv) return toast("Not found", `Invoice #${invoiceNo}`);

    // Load into form (optional), and also set preview
    $("invoiceNo").value = String(inv.invoiceNo || "");
    $("invoiceDate").value = String(inv.invoiceDate || "");
    $("dueDate").value = String(inv.dueDate || "");

    $("clientName").value = String(inv.clientName || "");
    $("clientAddress").value = String(inv.clientAddress || "");
    $("clientPhone").value = String(inv.clientPhone || "");
    $("clientEmail").value = String(inv.clientEmail || "");
    $("clientAbn").value = String(inv.clientABN || inv.clientAbn || "");

    $("gstToggle").checked = !!inv.gstEnabled;

    // items
    const tbody = $("itemsTable").querySelector("tbody");
    tbody.innerHTML = "";
    (inv.items || []).forEach((it) => addRow({ desc: it.desc, price: it.price, qty: it.qty }));
    if ((inv.items || []).length === 0) addRow();

    currentPreviewInvoice = { ...inv };
    showNewInvoice(); // show form first
    previewInvoice(); // then show preview
  }

  // ---------- preview + export ----------
  function buildPreviewHTML(inv) {
    const s = settings || DEFAULT_SETTINGS;
    const items = inv.items || [];
    const subtotal = Number(inv.subtotal) || 0;
    const gst = Number(inv.gst) || 0;
    const total = Number(inv.total) || 0;

    const rows = items
      .map((it) => {
        const amt = (Number(it.price) || 0) * (Number(it.qty) || 0);
        return `
          <tr>
            <td>${escapeHtml(it.desc)}</td>
            <td style="text-align:right;">$${money(it.price)}</td>
            <td style="text-align:right;">${money(it.qty)}</td>
            <td style="text-align:right;font-weight:900;">$${money(amt)}</td>
          </tr>
        `;
      })
      .join("");

    return `
      <div class="invoice-wrap">
        <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;">
          <div style="display:flex;gap:14px;align-items:flex-start;">
            <img src="assets/logo.png" alt="Starshine Logo" style="width:110px;border-radius:10px;" onerror="this.style.display='none'"/>
            <div style="font-size:12px;line-height:1.35;color:#222;margin-top:6px;">
              <div style="font-weight:950;font-size:16px;">${escapeHtml(s.businessName)}</div>
              <div><strong>ABN:</strong> ${escapeHtml(s.businessABN)}</div>
              <div>${escapeHtml(s.businessAddress1)}</div>
              <div>${escapeHtml(s.businessAddress2)}</div>
              <div>${escapeHtml(s.businessAddress3)}</div>
              ${s.businessPhone ? `<div><strong>Phone:</strong> ${escapeHtml(s.businessPhone)}</div>` : ""}
              ${s.businessEmail ? `<div>${escapeHtml(s.businessEmail)}</div>` : ""}
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:950;letter-spacing:.6px;">REGULAR INVOICE</div>
            <div style="margin-top:10px;font-size:12px;line-height:1.55;">
              <div><strong>Invoice date:</strong> ${escapeHtml(inv.invoiceDate)}</div>
              <div><strong>Due date:</strong> ${escapeHtml(inv.dueDate)}</div>
              <div><strong>Invoice no:</strong> ${escapeHtml(inv.invoiceNo)}</div>
            </div>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;gap:16px;margin-top:16px;">
          <div style="font-size:12px;line-height:1.55;">
            <div style="font-size:11px;color:#666;font-weight:950;letter-spacing:.8px;">BILL TO</div>
            <div style="font-weight:900;">${escapeHtml(inv.clientName)}</div>
            <div>${escapeHtml(inv.clientAddress)}</div>
            ${inv.clientPhone ? `<div>Phone: ${escapeHtml(inv.clientPhone)}</div>` : ""}
            ${inv.clientEmail ? `<div>Email: ${escapeHtml(inv.clientEmail)}</div>` : ""}
            ${(inv.clientABN || inv.clientAbn) ? `<div>ABN: ${escapeHtml(inv.clientABN || inv.clientAbn)}</div>` : ""}
          </div>
        </div>

        <div style="margin-top:14px;border:1px solid #e6e6e6;border-radius:12px;overflow:hidden;">
          <div style="display:grid;grid-template-columns: 1.6fr .5fr .4fr .5fr;gap:10px;padding:10px 12px;background:#f3f3f3;color:#666;font-size:11px;font-weight:950;letter-spacing:.8px;">
            <div>PRODUCT</div><div style="text-align:right;">PRICE</div><div style="text-align:right;">QTY</div><div style="text-align:right;">AMOUNT</div>
          </div>
          <div>
            <table style="width:100%;border-collapse:collapse;">
              <tbody>
                ${rows || `<tr><td>—</td><td style="text-align:right;">$0.00</td><td style="text-align:right;">0.00</td><td style="text-align:right;">$0.00</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;margin-top:12px;">
          <div style="width:320px;font-size:12px;line-height:1.7;">
            <div style="display:flex;justify-content:space-between;"><span>Net amount</span><span>$${money(subtotal)}</span></div>
            <div style="display:flex;justify-content:space-between;"><span>GST</span><span>$${money(gst)}</span></div>
            <div style="margin-top:6px;padding-top:8px;border-top:2px solid #111;display:flex;justify-content:space-between;font-weight:950;">
              <span>Total due (AUD)</span><span>$${money(total)}</span>
            </div>
          </div>
        </div>

        <div style="margin-top:14px;border-top:2px solid #e7d47a;padding-top:12px;display:flex;justify-content:space-between;gap:20px;">
          <div style="flex:1;font-size:12px;line-height:1.6;">
            <div style="font-weight:950;">PAYMENT INFORMATION</div>
            <div><strong>Invoice number:</strong> ${escapeHtml(inv.invoiceNo)}</div>
            <div><strong>Amount (AUD):</strong> $${money(total)}</div>
            <div style="font-size:11px;color:#666;margin-top:6px;">Please add the invoice number to the payment transfer.</div>
          </div>
          <div style="flex:1;font-size:12px;line-height:1.6;">
            <div style="font-weight:950;">&nbsp;</div>
            <div><strong>Account name:</strong> ${escapeHtml(s.payAccountName)}</div>
            <div><strong>Account number:</strong> ${escapeHtml(s.payAccountNumber)}</div>
            <div><strong>Bank name:</strong> ${escapeHtml(s.payBankName)}</div>
            <div><strong>BSB:</strong> ${escapeHtml(s.payBSB)}</div>
          </div>
        </div>
      </div>
    `;
  }

  function previewInvoice() {
    const inv = getInvoiceFromForm();
    const err = validateInvoice(inv);
    if (err) return toast("Can't preview invoice", err);

    currentPreviewInvoice = inv;

    const preview = $("previewSection");
    preview.innerHTML = `
      ${buildPreviewHTML(inv)}
      <div class="preview-actions">
        <button class="btn" onclick="showNewInvoice()">Back</button>
        <button class="btn primary" onclick="exportPDF()">Export PDF</button>
      </div>
    `;

    showOnly("previewSection");
    setActiveNav(""); // no nav highlight in preview
  }

  async function exportPDF(invMaybe) {
    const inv = invMaybe || currentPreviewInvoice || getInvoiceFromForm();
    const err = validateInvoice(inv);
    if (err) return toast("Can't export PDF", err);

    // If electron preload is available, use real printToPDF (fixes blank PDFs)
    if (window.starshineAPI && typeof window.starshineAPI.exportPDF === "function") {
      saveState();
      const res = await window.starshineAPI.exportPDF(inv, settings);
      if (res?.ok && res.filePath) {
        toast("PDF saved", res.filePath);
        // auto-open? ask (keeps it clean)
        setTimeout(async () => {
          const open = confirm(`Saved PDF:\n\n${res.filePath}\n\nOpen it now?`);
          if (open && window.starshineAPI?.openPath) await window.starshineAPI.openPath(res.filePath);
        }, 50);
        return;
      }
      if (res?.canceled) return;
      return toast("PDF export failed", res?.error || "Unknown error");
    }

    // Fallback (browser)
    toast("Export fallback", "Using print dialog");
    window.print();
  }

  // ---------- clients ----------
  function loadSavedClientSelect() {
    const sel = $("savedClientSelect");
    sel.innerHTML = `<option value="">— Select saved client —</option>`;
    clients
      .slice()
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
      .forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = `${c.name}${c.phone ? " — " + c.phone : ""}`;
        sel.appendChild(opt);
      });
  }

  function applySelectedClient() {
    const id = $("savedClientSelect").value;
    if (!id) return;
    const c = clients.find((x) => x.id === id);
    if (!c) return;

    $("clientName").value = c.name || "";
    $("clientAddress").value = c.address || "";
    $("clientPhone").value = c.phone || "";
    $("clientEmail").value = c.email || "";
    $("clientAbn").value = c.abn || "";

    toast("Client applied", c.name || "");
  }

  function saveClientFromInvoice() {
    const name = String($("clientName").value || "").trim();
    const address = String($("clientAddress").value || "").trim();
    const phone = String($("clientPhone").value || "").trim();
    const email = String($("clientEmail").value || "").trim();
    const abn = String($("clientAbn").value || "").trim();

    if (!name) return toast("Can't save client", "Client name required.");
    if (!address) return toast("Can't save client", "Client address required.");

    // upsert by name+phone (good enough for now)
    const existing = clients.find((c) => (c.name || "").toLowerCase() === name.toLowerCase() && (c.phone || "") === phone);
    if (existing) {
      existing.address = address;
      existing.phone = phone;
      existing.email = email;
      existing.abn = abn;
      existing.updatedAt = new Date().toISOString();
    } else {
      clients.unshift({
        id: (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)),
        name,
        address,
        phone,
        email,
        abn,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    saveState();
    loadSavedClientSelect();
    loadClientsUI();
    toast("Client saved", name);
  }

  function clearClientForm() {
    $("c_id").value = "";
    $("c_name").value = "";
    $("c_address").value = "";
    $("c_phone").value = "";
    $("c_email").value = "";
    $("c_abn").value = "";
    toast("Client form cleared");
  }

  function fillClientForm(c) {
    $("c_id").value = c.id;
    $("c_name").value = c.name || "";
    $("c_address").value = c.address || "";
    $("c_phone").value = c.phone || "";
    $("c_email").value = c.email || "";
    $("c_abn").value = c.abn || "";
  }

  function saveClient() {
    const id = String($("c_id").value || "").trim();
    const name = String($("c_name").value || "").trim();
    const address = String($("c_address").value || "").trim();
    const phone = String($("c_phone").value || "").trim();
    const email = String($("c_email").value || "").trim();
    const abn = String($("c_abn").value || "").trim();

    if (!name) return toast("Can't save client", "Client name required.");
    if (!address) return toast("Can't save client", "Client address required.");

    if (id) {
      const c = clients.find((x) => x.id === id);
      if (!c) return toast("Not found", "Client record missing.");
      c.name = name;
      c.address = address;
      c.phone = phone;
      c.email = email;
      c.abn = abn;
      c.updatedAt = new Date().toISOString();
    } else {
      clients.unshift({
        id: (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)),
        name,
        address,
        phone,
        email,
        abn,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    saveState();
    loadSavedClientSelect();
    loadClientsUI();
    toast("Client saved", name);
  }

  function deleteClientFromForm() {
    const id = String($("c_id").value || "").trim();
    if (!id) return toast("No client selected");
    const c = clients.find((x) => x.id === id);
    if (!c) return toast("Not found", "Client record missing.");
    if (!confirm(`Delete client "${c.name}"?`)) return;

    clients = clients.filter((x) => x.id !== id);
    saveState();
    loadSavedClientSelect();
    loadClientsUI();
    clearClientForm();
    toast("Client deleted", c.name);
  }

  function useClientFormForInvoice() {
    const name = String($("c_name").value || "").trim();
    const address = String($("c_address").value || "").trim();
    const phone = String($("c_phone").value || "").trim();
    const email = String($("c_email").value || "").trim();
    const abn = String($("c_abn").value || "").trim();

    if (!name || !address) return toast("Can't use client", "Name + address required.");

    $("clientName").value = name;
    $("clientAddress").value = address;
    $("clientPhone").value = phone;
    $("clientEmail").value = email;
    $("clientAbn").value = abn;

    toast("Client applied", name);
    showNewInvoice();
  }

  function loadClientsUI() {
    const q = String($("clientsSearchBox").value || "").trim().toLowerCase();
    const list = $("clientsList");
    list.innerHTML = "";

    const filtered = clients
      .slice()
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
      .filter((c) => {
        if (!q) return true;
        const blob = [c.name, c.phone, c.address, c.email, c.abn].join(" ").toLowerCase();
        return blob.includes(q);
      });

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.style.fontWeight = "850";
      empty.textContent = "No clients saved yet.";
      list.appendChild(empty);
      return;
    }

    filtered.forEach((c) => {
      const card = document.createElement("div");
      card.className = "card";

      const left = document.createElement("div");
      left.className = "card-left";
      left.innerHTML = `
        <div class="title">${escapeHtml(c.name || "Client")}</div>
        <div class="meta">${escapeHtml([c.phone, c.email].filter(Boolean).join(" • ") || c.address || "")}</div>
      `;

      const right = document.createElement("div");
      right.className = "card-right";

      const useBtn = document.createElement("button");
      useBtn.className = "btn primary";
      useBtn.textContent = "Use";
      useBtn.onclick = () => {
        $("clientName").value = c.name || "";
        $("clientAddress").value = c.address || "";
        $("clientPhone").value = c.phone || "";
        $("clientEmail").value = c.email || "";
        $("clientAbn").value = c.abn || "";
        $("savedClientSelect").value = c.id;
        toast("Client applied", c.name || "");
        showNewInvoice();
      };

      const editBtn = document.createElement("button");
      editBtn.className = "btn";
      editBtn.textContent = "Edit";
      editBtn.onclick = () => fillClientForm(c);

      const delBtn = document.createElement("button");
      delBtn.className = "btn danger";
      delBtn.textContent = "Delete";
      delBtn.onclick = () => {
        if (!confirm(`Delete client "${c.name}"?`)) return;
        clients = clients.filter((x) => x.id !== c.id);
        saveState();
        loadSavedClientSelect();
        loadClientsUI();
        toast("Client deleted", c.name);
      };

      right.appendChild(useBtn);
      right.appendChild(editBtn);
      right.appendChild(delBtn);

      card.appendChild(left);
      card.appendChild(right);
      list.appendChild(card);
    });
  }

  // ---------- company settings quick editor (adds button into dashboard toolbar) ----------
  function injectCompanyButton() {
    const toolbar = document.querySelector("#dashboard .toolbar");
    if (!toolbar) return;
    if (toolbar.querySelector("[data-company-btn='1']")) return;

    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "Company";
    btn.setAttribute("data-company-btn", "1");
    btn.onclick = () => {
      const phone = prompt("Business phone:", settings.businessPhone || "");
      if (phone === null) return;
      const email = prompt("Business email:", settings.businessEmail || "");
      if (email === null) return;
      const abn = prompt("Business ABN:", settings.businessABN || "");
      if (abn === null) return;
      settings.businessPhone = String(phone).trim();
      settings.businessEmail = String(email).trim();
      settings.businessABN = String(abn).trim();
      saveState();
      toast("Company saved");
    };

    toolbar.appendChild(btn);
  }

  // ---------- navigation ----------
  function showDashboard() {
    setActiveNav("dash");
    showOnly("dashboard");
    loadHistory();
    injectCompanyButton();
  }

  function showNewInvoice() {
    setActiveNav("new");
    showOnly("newInvoice");
    ensureInvoiceDefaults();
    loadSavedClientSelect();

    // ensure at least 1 row exists
    const tbody = $("itemsTable").querySelector("tbody");
    if (tbody.children.length === 0) addRow({ desc: "General Clean", price: 0, qty: 1 });

    calculate();
  }

  function showClients() {
    setActiveNav("clients");
    showOnly("clients");
    loadClientsUI();
  }

  // ---------- expose functions to HTML onclick ----------
  window.showDashboard = showDashboard;
  window.showNewInvoice = showNewInvoice;
  window.showClients = showClients;

  window.loadHistory = loadHistory;
  window.clearAllInvoices = clearAllInvoices;

  window.applySelectedClient = applySelectedClient;
  window.saveClientFromInvoice = saveClientFromInvoice;
  window.clearClientFields = clearClientFields;

  window.addRow = addRow;
  window.calculate = calculate;
  window.saveInvoice = saveInvoice;
  window.previewInvoice = previewInvoice;

  window.loadClientsUI = loadClientsUI;
  window.clearClientForm = clearClientForm;
  window.saveClient = saveClient;
  window.useClientFormForInvoice = useClientFormForInvoice;
  window.deleteClientFromForm = deleteClientFromForm;

  window.exportPDF = exportPDF;

  // ---------- init ----------
  document.addEventListener("DOMContentLoaded", () => {
    loadState();
    saveState(); // normalize settings storage

    // defaults
    $("invoiceDate").value = todayDDMMYYYY();
    $("dueDate").value = addDaysDDMMYYYY(7);
    $("gstToggle").checked = true;
    $("invoiceNo").value = String(getInvoiceCounter());

    showDashboard();
  });
})();