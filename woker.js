/**
 * ==============================================================================
 * TEMP MAIL PRO - SERVERLESS CLOUDFLARE WORKER
 * ==============================================================================
 */
const CONFIG = {
  DOMAINS: ["@qubit.qzz.io", "@sucvat.qzz.io"], // Thay đổi domain của bạn
  TTL: {
    EMAIL: 1800,       // 30 phút
    ACCOUNT: 3600,     // 1 giờ
    COOKIE: 30         // 30 ngày
  },
  COOKIE_NAME: "tm_session",
  SECRET_LEN: 32,
};

// ==============================================================================
// 1. EMAIL HANDLER (SMTP INBOUND)
// ==============================================================================
export default {
  async email(message, env, ctx) {
    if (!env.EMAILS) throw new Error("KV 'EMAILS' not bound!");

    try {
      const from = message.from;
      const to = message.to.toLowerCase(); 
      const subject = message.headers.get("subject") || "(No Subject)";
      
      // Đọc raw content
      const rawBody = await new Response(message.raw).text();
      
      const now = new Date();
      const timestamp = now.toISOString();
      const id = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

      // ---------------------------------------------------------
      // SMART PARSER: Logic xử lý đệ quy đa tầng + Safety Net
      // ---------------------------------------------------------
      let body = { type: 'text', content: '' };
      try {
        body = smartParseEmail(rawBody);
        
        // --- SAFETY NET: Vét cạn lỗi Quoted-Printable ---
        // Nếu nội dung vẫn còn dấu hiệu "=3D" (ví dụ: href=3D, =3D"...)
        if (body.content && (body.content.includes("=3D") || body.content.includes("=3d"))) {
           console.log(`Force decoding Quoted-Printable for email ${id}`);
           body.content = decodeQuotedPrintableUtf8(body.content);
        }
        
        // --- AUTO DETECT HTML: Nếu type là text nhưng nội dung giống HTML ---
        if (body.type === 'text' && /<html|<body|<\/div>/i.test(body.content)) {
            body.type = 'html';
        }
        
      } catch (e) {
        console.error("Parse error, fallback to raw:", e);
        body = { type: 'text', content: rawBody };
      }

      // Sanitize Content (Chỉ xử lý script, giữ lại style để hiển thị trong iframe)
      if (body.type === 'html') {
        body.content = sanitizeAndSecureHtml(body.content);
      } else {
        body.content = linkifyText(body.content);
      }

      const emailData = {
        id, from, to, subject, date: timestamp,
        body: body.content, type: body.type
      };

      // Save Email (Key: email:<address>:<id>)
      await env.EMAILS.put(`email:${to}:${id}`, JSON.stringify(emailData), {
        expirationTtl: CONFIG.TTL.EMAIL
      });

      // Keep-Alive Account
      const accountKey = `account:${to}`;
      const account = await env.EMAILS.get(accountKey);
      if (account) {
        await env.EMAILS.put(accountKey, account, { expirationTtl: CONFIG.TTL.ACCOUNT });
      }
      
      console.log(`Saved email ${id} for ${to}`);

    } catch (err) {
      console.error(`Email Error: ${err.message}`);
    }
  },

  // ==============================================================================
  // 2. HTTP HANDLER (UI & API)
  // ==============================================================================
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // --- API ROUTES ---
    if (path.startsWith('/api')) {
      return handleApi(request, env, url);
    }

    // --- UI ROUTES ---
    const session = getSession(request);

    // Route: Documentation
    if (path === '/docs') return new Response(renderDocs(), htmlHeader());

    // Route: Auth Actions (UI Forms)
    if (path === '/auth' && request.method === 'POST') {
      const formData = await request.formData();
      const action = formData.get('action');

      if (action === 'create') {
        const domain = formData.get('domain') || CONFIG.DOMAINS[0];
        const account = await createAccount(env, domain);
        return setCookieAndRedirect(account.address, account.secret, "/");
      }

      if (action === 'restore') {
        const address = formData.get('address').trim().toLowerCase();
        const secret = formData.get('secret').trim();
        
        const storedData = await env.EMAILS.get(`account:${address}`);
        if (!storedData) return new Response("Account expired or invalid.", { status: 403 });
        if (JSON.parse(storedData).secret !== secret) return new Response("Invalid Secret Key.", { status: 401 });

        return setCookieAndRedirect(address, secret, "/");
      }
    }

    // Route: Logout
    if (path === '/logout') {
      return new Response(null, {
        status: 302,
        headers: {
          "Location": "/",
          "Set-Cookie": `${CONFIG.COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict`
        }
      });
    }

    // Route: Email Detail
    if (path.startsWith('/email/')) {
      if (!session) return Response.redirect(url.origin, 302);
      const id = path.split('/').pop();
      const list = await env.EMAILS.list({ prefix: `email:${session.address}:` });
      let foundKey = null;
      for (const k of list.keys) {
        if (k.name.endsWith(id)) foundKey = k.name;
      }

      if (!foundKey) return new Response("Email not found", { status: 404 });
      const emailRaw = await env.EMAILS.get(foundKey);
      return new Response(renderEmailDetail(JSON.parse(emailRaw), session), htmlHeader());
    }

    // Route: Inbox / Landing
    if (!session) {
      return new Response(renderLanding(), htmlHeader());
    } else {
      const accountExists = await env.EMAILS.get(`account:${session.address}`);
      if (!accountExists) return Response.redirect(`${url.origin}/logout`, 302);

      const list = await env.EMAILS.list({ prefix: `email:${session.address}:` });
      const emails = [];
      for (const key of list.keys) {
        const d = await env.EMAILS.get(key.name);
        if (d) emails.push(JSON.parse(d));
      }
      
      emails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return new Response(renderInbox(emails, session), htmlHeader());
    }
  }
};

// ==============================================================================
// 3. API LOGIC (UPDATED)
// ==============================================================================
async function handleApi(req, env, url) {
  const headers = { 
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE" 
  };
  const path = url.pathname;

  // 3.1 Create New Account via API
  if (path === '/api/new') {
    const domain = url.searchParams.get('domain') || CONFIG.DOMAINS[0];
    if (!CONFIG.DOMAINS.includes(domain)) {
        return json({ error: "Invalid domain" }, 400, headers);
    }
    const account = await createAccount(env, domain);
    return json(account, 200, headers);
  }

  // 3.2 Get Messages
  if (path === '/api/messages') {
    const address = url.searchParams.get('address');
    const secret = url.searchParams.get('secret');

    if (!address || !secret) return json({ error: "Missing 'address' or 'secret'" }, 400, headers);

    const account = await env.EMAILS.get(`account:${address}`);
    if (!account || JSON.parse(account).secret !== secret) {
      return json({ error: "Unauthorized" }, 401, headers);
    }

    const list = await env.EMAILS.list({ prefix: `email:${address}:` });
    const messages = [];
    for (const key of list.keys) {
      const m = await env.EMAILS.get(key.name);
      if(m) messages.push(JSON.parse(m));
    }
    messages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    return json(messages, 200, headers);
  }

  return json({ error: "Endpoint not found" }, 404, headers);
}

// Logic tạo account dùng chung
async function createAccount(env, domain) {
    const name = generateReadableName();
    const address = `${name}${domain}`.toLowerCase(); // Ensure lowercase
    const secret = generateSecret();
    
    await env.EMAILS.put(`account:${address}`, JSON.stringify({ secret, created: Date.now() }), {
      expirationTtl: CONFIG.TTL.ACCOUNT
    });
    return { address, secret };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: extraHeaders });
}

// ==============================================================================
// 4. HELPERS
// ==============================================================================
function getSession(req) {
  const cookieHeader = req.headers.get("Cookie");
  if (!cookieHeader) return null;
  const cookies = Object.fromEntries(cookieHeader.split('; ').map(c => c.split('=')));
  const val = cookies[CONFIG.COOKIE_NAME];
  if (!val) return null;
  try {
    const [address, secret] = decodeURIComponent(val).split('|');
    return { address, secret };
  } catch(e) { return null; }
}

function setCookieAndRedirect(address, secret, path) {
  const val = encodeURIComponent(`${address}|${secret}`);
  const expires = new Date();
  expires.setDate(expires.getDate() + CONFIG.TTL.COOKIE);
  return new Response(null, {
    status: 302,
    headers: {
      "Location": path,
      "Set-Cookie": `${CONFIG.COOKIE_NAME}=${val}; Path=/; Expires=${expires.toUTCString()}; HttpOnly; Secure; SameSite=Strict`
    }
  });
}

function generateReadableName() {
  const c = "bdfghjklmnprstvz";
  const v = "aeiou";
  const r = (arr) => arr[Math.floor(Math.random() * arr.length)];
  return `${r(c)}${r(v)}${r(c)}${r(v)}${Math.floor(Math.random()*100)}`;
}

function generateSecret() {
  const array = new Uint8Array(CONFIG.SECRET_LEN / 2);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// -----------------------------------------------------------------------------
// IMPROVED RECURSIVE EMAIL PARSER (THÔNG MINH HƠN)
// -----------------------------------------------------------------------------
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function smartParseEmail(raw) {
  const result = { html: "", text: "" };

  function processPart(headers, body) {
    const contentType = (headers.match(/Content-Type:\s*([^;\r\n]+)/i) || [])[1] || "text/plain";
    const encoding = (headers.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i) || [])[1] || "";

    // 1. Xử lý Multipart (Đệ quy)
    if (contentType.toLowerCase().includes("multipart")) {
      const boundaryMatch = headers.match(/boundary="?([^";\r\n]+)"?/i);
      if (boundaryMatch) {
        const boundary = boundaryMatch[1];
        // FIX: Sử dụng escapeRegex để tránh lỗi khi boundary chứa ký tự đặc biệt
        const parts = body.split(new RegExp(`--${escapeRegex(boundary)}(?:--)?`));
        
        for (const part of parts) {
            // Trim khoảng trắng đầu/cuối
            const partTrimmed = part.replace(/^\s+/, "").replace(/\s+$/, "");
            if (!partTrimmed) continue;

            // Tách Header/Body của Part con
            let splitIdx = partTrimmed.indexOf("\r\n\r\n");
            if (splitIdx === -1) splitIdx = partTrimmed.indexOf("\n\n");
            
            if (splitIdx !== -1) {
                const partHeaders = partTrimmed.slice(0, splitIdx);
                const partBody = partTrimmed.slice(splitIdx).trim();
                processPart(partHeaders, partBody);
            } else {
                if(partTrimmed.length > 5) {
                    processPart("Content-Type: text/plain", partTrimmed);
                }
            }
        }
      }
      return;
    }

    // 2. Xử lý Leaf Node (Nội dung thực)
    let content = body;
    if (encoding.toLowerCase().includes("base64")) {
        content = decodeBase64Utf8(content);
    } else if (encoding.toLowerCase().includes("quoted-printable")) {
        content = decodeQuotedPrintableUtf8(content);
    }

    if (contentType.toLowerCase().includes("html")) {
        result.html += content;
    } else {
        result.text += content;
    }
  }

  let splitIdx = raw.indexOf("\r\n\r\n");
  if (splitIdx === -1) splitIdx = raw.indexOf("\n\n");
  
  if (splitIdx !== -1) {
    processPart(raw.slice(0, splitIdx), raw.slice(splitIdx).trim());
  } else {
    result.text = raw;
  }

  return {
    type: result.html ? 'html' : 'text',
    content: result.html || result.text || raw
  };
}

// ===== ROBUST QUOTED-PRINTABLE DECODER (FIXED) =====
function decodeQuotedPrintableUtf8(input) {
  if (!input) return "";
  let str = input.replace(/[\t\x20]*=\r?\n/g, "");
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '=') {
      const hex = str.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2; 
        continue;
      }
    }
    bytes.push(c.charCodeAt(0));
  }
  try {
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  } catch (e) {
    return str;
  }
}

function decodeBase64Utf8(str) {
  str = str.replace(/\s/g, "");
  try {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch(e) { return str; }
}

function sanitizeAndSecureHtml(html) {
  let clean = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "");
  clean = clean.replace(/<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1/gi, (match, quote, url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:#3b82f6; text-decoration:underline;">`;
  });
  return clean;
}

function linkifyText(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.replace(urlRegex, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:#3b82f6;">${url}</a>`);
}

function getAvatar(name) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6366f1&color=fff&size=64&font-size=0.5&bold=true`;
}

// ==============================================================================
// 5. UI RENDERING (NEW PROFESSIONAL DASHBOARD)
// ==============================================================================

function htmlHeader() {
  return { headers: { "Content-Type": "text/html; charset=utf-8" } };
}

function baseLayout(content) {
  return `
  <!DOCTYPE html>
  <html lang="en" class="h-full bg-slate-950">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TempMail Pro</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script>
      tailwind.config = {
        theme: {
          extend: {
            fontFamily: { sans: ['"Plus Jakarta Sans"', 'sans-serif'] },
            colors: {
              brand: { 500: '#6366f1', 600: '#4f46e5' },
              dark: { 800: '#1e293b', 900: '#0f172a' }
            }
          }
        }
      }
    </script>
    <style type="text/tailwindcss">
      body { color: #f8fafc; }
      .glass { background: #1e293b; border: 1px solid #334155; }
      .btn { @apply inline-flex items-center justify-center rounded-lg px-4 py-2 font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 focus:ring-offset-slate-900; }
      .btn-primary { @apply bg-brand-600 text-white hover:bg-brand-500; }
      .btn-ghost { @apply text-slate-400 hover:text-white hover:bg-slate-800; }
      .input { @apply w-full rounded-lg bg-slate-900 border border-slate-700 px-4 py-2 text-white placeholder-slate-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500; }
      
      /* Iframe reset */
      iframe { border: none; width: 100%; display: block; background: white; }
    </style>
  </head>
  <body class="h-full flex flex-col">
    <!-- Navbar -->
    <nav class="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="flex h-16 items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white shadow-lg shadow-brand-500/20">
              <i class="fa-solid fa-paper-plane text-sm"></i>
            </div>
            <span class="text-lg font-bold tracking-tight text-white">TempMail<span class="text-brand-500">Pro</span></span>
          </div>
          <div class="flex items-center gap-4">
            <a href="/docs" class="text-sm font-medium text-slate-400 hover:text-white transition-colors">API Docs</a>
            <a href="https://github.com/hiep-py/mail-temp" target="_blank" class="text-slate-400 hover:text-white transition-colors"><i class="fa-brands fa-github text-lg"></i></a>
          </div>
        </div>
      </div>
    </nav>

    <!-- Content -->
    <main class="flex-1">
      ${content}
    </main>

    <!-- Footer -->
    <footer class="border-t border-slate-800 bg-slate-950 py-8">
      <div class="mx-auto max-w-7xl px-4 text-center text-sm text-slate-500">
        <p class="mb-2">&copy; ${new Date().getFullYear()} TempMail Pro. Powered by <span class="text-slate-300 font-semibold">Ho Hiep</span></p>
        <a href="https://hohiep.io.vn" target="_blank" class="text-brand-500 hover:text-brand-400 font-medium transition-colors">
          <i class="fa-solid fa-globe mr-1"></i> hohiep.io.vn
        </a>
      </div>
    </footer>
  </body>
  </html>
  `;
}

function renderLanding() {
  const domains = CONFIG.DOMAINS.map(d => `<option value="${d}">${d}</option>`).join("");
  return baseLayout(`
    <div class="relative overflow-hidden pt-16 pb-24 sm:pt-24 sm:pb-32">
       <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
         <div class="mx-auto max-w-2xl text-center">
           <h1 class="text-4xl font-extrabold tracking-tight text-white sm:text-6xl mb-6">
             Disposable email, <br>
             <span class="text-brand-500">developer ready.</span>
           </h1>
           <p class="text-lg leading-8 text-slate-400 mb-10">
             Instant access to temporary inboxes. Real-time API. No spam, no ads, purely functional for testing and automation.
           </p>

           <div class="glass rounded-2xl p-6 sm:p-10 shadow-2xl shadow-black/50 mx-auto max-w-md bg-slate-900/50 backdrop-blur">
             <!-- Generate -->
             <form action="/auth" method="POST" class="space-y-4">
               <input type="hidden" name="action" value="create">
               <div>
                 <label class="block text-xs font-semibold uppercase text-slate-400 mb-2 text-left">Create Inbox</label>
                 <div class="flex gap-2">
                   <div class="relative flex-1">
                     <select name="domain" class="input appearance-none cursor-pointer">
                       ${domains}
                     </select>
                     <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
                       <i class="fa-solid fa-chevron-down text-xs"></i>
                     </div>
                   </div>
                   <button type="submit" class="btn btn-primary whitespace-nowrap shadow-lg shadow-brand-500/20">
                     <i class="fa-solid fa-wand-magic-sparkles mr-2"></i> Create
                   </button>
                 </div>
               </div>
             </form>
             
             <div class="relative my-8">
               <div class="absolute inset-0 flex items-center"><div class="w-full border-t border-slate-800"></div></div>
               <div class="relative flex justify-center text-xs uppercase"><span class="bg-slate-900 px-2 text-slate-500">Or Resume Session</span></div>
             </div>

             <!-- Restore -->
             <form action="/auth" method="POST" class="space-y-3">
               <input type="hidden" name="action" value="restore">
               <input type="text" name="address" placeholder="email@domain.com" class="input text-sm" required>
               <input type="password" name="secret" placeholder="Secret Key" class="input text-sm font-mono" required>
               <button type="submit" class="btn btn-ghost w-full border border-slate-700">
                 Restore Access
               </button>
             </form>
           </div>
         </div>
       </div>
    </div>
  `);
}

function renderInbox(emails, session) {
  const hasEmails = emails.length > 0;
  
  const emailListHtml = !hasEmails 
    ? `
      <div class="flex flex-col items-center justify-center py-24 text-center">
        <div class="h-24 w-24 rounded-full bg-slate-800/50 flex items-center justify-center mb-6">
          <i class="fa-regular fa-envelope text-4xl text-slate-600"></i>
        </div>
        <h3 class="text-xl font-semibold text-white mb-2">Inbox is empty</h3>
        <p class="text-slate-400 max-w-xs">Emails sent to this address will appear here instantly. Auto-refresh is on.</p>
        <div class="mt-6 flex items-center gap-2 text-xs text-brand-500 bg-brand-500/10 px-3 py-1 rounded-full">
           <span class="relative flex h-2 w-2">
             <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75"></span>
             <span class="relative inline-flex rounded-full h-2 w-2 bg-brand-500"></span>
           </span>
           Live Listening
        </div>
      </div>
    `
    : `<ul class="divide-y divide-slate-800">
        ${emails.map(e => {
          const fromName = e.from.split('<')[0].trim().replace(/"/g, '') || 'Unknown';
          const time = new Date(e.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
          return `
          <li>
            <a href="/email/${e.id.split('-').pop()}" class="block hover:bg-slate-800/50 transition-colors duration-150 px-6 py-5">
              <div class="flex items-center gap-4">
                <img src="${getAvatar(fromName)}" class="h-10 w-10 rounded-full bg-slate-800" alt="">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between mb-1">
                    <p class="truncate text-sm font-semibold text-white">${fromName}</p>
                    <p class="whitespace-nowrap text-xs text-slate-500 font-mono">${time}</p>
                  </div>
                  <p class="truncate text-sm font-medium text-slate-300 mb-0.5">${e.subject}</p>
                  <p class="truncate text-xs text-slate-500">${e.body.substring(0, 120)}...</p>
                </div>
              </div>
            </a>
          </li>
          `;
        }).join("")}
       </ul>`;

  return baseLayout(`
    <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        <!-- Sidebar / Info -->
        <div class="lg:col-span-4 space-y-6">
          <div class="glass rounded-xl p-6 bg-slate-900/50">
            <h2 class="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Current Session</h2>
            
            <div class="space-y-4">
              <div>
                <label class="text-xs text-slate-500 mb-1 block">Email Address</label>
                <div class="flex gap-2">
                  <code class="flex-1 rounded bg-slate-950 border border-slate-800 px-3 py-2 font-mono text-sm text-brand-400 truncate select-all">
                    ${session.address}
                  </code>
                  <button onclick="copy('${session.address}')" class="btn btn-ghost px-3 border border-slate-700 text-slate-400">
                    <i class="fa-regular fa-copy"></i>
                  </button>
                </div>
              </div>

              <div>
                <label class="text-xs text-slate-500 mb-1 block">Secret Key (Auth)</label>
                <div class="flex gap-2">
                  <code class="flex-1 rounded bg-slate-950 border border-slate-800 px-3 py-2 font-mono text-xs text-slate-400 truncate select-all blur-sm hover:blur-none transition-all duration-300">
                    ${session.secret}
                  </code>
                  <button onclick="copy('${session.secret}')" class="btn btn-ghost px-3 border border-slate-700 text-slate-400">
                    <i class="fa-solid fa-key"></i>
                  </button>
                </div>
              </div>
            </div>

            <div class="mt-6 pt-6 border-t border-slate-800 flex gap-3">
              <button onclick="window.location.reload()" class="btn btn-primary flex-1 text-sm">
                <i class="fa-solid fa-rotate mr-2"></i> Refresh
              </button>
              <a href="/logout" class="btn btn-ghost border border-slate-700 text-red-400 hover:text-red-300 hover:bg-red-500/10 hover:border-red-500/50 px-3">
                <i class="fa-solid fa-power-off"></i>
              </a>
            </div>
          </div>

          <!-- Quick API Info -->
          <div class="glass rounded-xl p-6 bg-slate-900/50 hidden lg:block">
            <h3 class="text-sm font-semibold text-slate-400 mb-3">Developer Quick Link</h3>
            <p class="text-xs text-slate-500 mb-3">Fetch these messages via JSON:</p>
            <div class="bg-slate-950 rounded p-2 border border-slate-800 overflow-x-auto">
              <code class="text-[10px] font-mono text-green-400 whitespace-nowrap">
                GET /api/messages?address=${session.address}&secret=...
              </code>
            </div>
          </div>
        </div>

        <!-- Main Inbox -->
        <div class="lg:col-span-8">
          <div class="glass rounded-xl overflow-hidden bg-slate-900/30 min-h-[600px] flex flex-col">
            <div class="border-b border-slate-800 px-6 py-4 flex items-center justify-between bg-slate-900/50">
              <h2 class="font-bold text-white flex items-center gap-2">
                Inbox <span class="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-300">${emails.length}</span>
              </h2>
              <span class="text-xs text-slate-500 flex items-center gap-1">
                <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span> Auto-refresh
              </span>
            </div>
            
            <div class="flex-1">
              ${emailListHtml}
            </div>
          </div>
        </div>

      </div>
    </div>
    <script>
      function copy(text) {
        navigator.clipboard.writeText(text);
        // Toast could go here
      }
      setTimeout(() => window.location.reload(), 15000);
    </script>
  `);
}

function renderEmailDetail(email, session) {
  // 1. AUTO-FIX: Giải mã Quoted-Printable tại thời điểm hiển thị (View-time)
  if (email.body && (email.body.includes("=3D") || email.body.includes("=3d"))) {
     email.body = decodeQuotedPrintableUtf8(email.body);
  }

  // 2. FORCE HTML: Nếu đánh dấu là text nhưng nội dung là HTML (do auto-detect)
  if (email.type === 'text' && /<html|<body|<\/div>/i.test(email.body)) {
      email.type = 'html';
  }

  let contentHtml = "";
  if (email.type === 'html') {
    // FIX: Escape an toàn tuyệt đối cho srcdoc để tránh vỡ iframe
    const safeSrcDoc = email.body
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    contentHtml = `
      <iframe srcdoc="${safeSrcDoc}" 
        class="w-full bg-white rounded-b-lg"
        style="min-height: 600px; border: 0;"
        onload="this.style.height = (this.contentWindow.document.documentElement.scrollHeight + 50) + 'px'"
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin">
      </iframe>`;
  } else {
    contentHtml = `<div class="p-8 whitespace-pre-wrap font-mono text-sm text-slate-800 bg-white min-h-[400px] rounded-b-lg">${email.body}</div>`;
  }

  return baseLayout(`
    <div class="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <div class="mb-6">
        <a href="/" class="btn btn-ghost pl-0 hover:bg-transparent hover:text-brand-400 transition-colors">
          <i class="fa-solid fa-arrow-left mr-2"></i> Back to Inbox
        </a>
      </div>

      <div class="glass rounded-xl overflow-hidden shadow-2xl shadow-black/20">
        <!-- Header -->
        <div class="bg-slate-900 p-6 sm:p-8 border-b border-slate-800">
          <h1 class="text-2xl font-bold text-white mb-6 leading-snug">${email.subject}</h1>
          
          <div class="flex flex-wrap items-center justify-between gap-6">
            <div class="flex items-center gap-4">
              <img src="${getAvatar(email.from)}" class="h-12 w-12 rounded-full ring-2 ring-slate-700" alt="">
              <div>
                <div class="text-base font-medium text-white">${email.from}</div>
                <div class="text-sm text-slate-400">To: ${email.to}</div>
              </div>
            </div>
            <div class="text-right">
              <div class="text-sm font-medium text-slate-200">${new Date(email.date).toLocaleDateString()}</div>
              <div class="text-xs text-slate-500">${new Date(email.date).toLocaleTimeString()}</div>
            </div>
          </div>
        </div>

        <!-- Body -->
        <div class="bg-white w-full">
           ${contentHtml}
        </div>
      </div>
    </div>
  `);
}

function renderDocs() {
  return baseLayout(`
    <div class="mx-auto max-w-4xl px-4 py-12">
      <div class="mb-12">
        <h1 class="text-3xl font-bold text-white mb-2">API Documentation</h1>
        <p class="text-slate-400 text-lg">Automate your email workflows with simple JSON endpoints.</p>
      </div>

      <div class="space-y-10">
        
        <!-- 1. Authentication -->
        <section>
          <div class="glass rounded-xl p-6 bg-slate-900/30">
            <h2 class="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <i class="fa-solid fa-key text-brand-500"></i> Authentication
            </h2>
            <p class="text-sm text-slate-400 mb-4">
              The API uses query parameters for authentication. You need an <code>address</code> and a <code>secret</code> key.
              These are generated when you create a new account.
            </p>
          </div>
        </section>

        <!-- 2. Create Account -->
        <section>
          <div class="flex items-center gap-3 mb-4">
            <span class="bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-1 rounded text-xs font-mono font-bold">GET / POST</span>
            <h3 class="text-lg font-bold text-white">/api/new</h3>
          </div>
          <div class="glass rounded-xl overflow-hidden">
            <div class="border-b border-slate-800 bg-slate-900/50 px-4 py-2 text-xs font-mono text-slate-400">
              Create a new inbox credentials
            </div>
            <div class="p-6 space-y-4">
              <p class="text-sm text-slate-300">Generates a random email address and a secret key. Use these credentials to fetch messages later.</p>
              
              <div>
                <div class="text-xs font-semibold text-slate-500 mb-2 uppercase">Parameters</div>
                <div class="grid grid-cols-3 gap-4 text-sm border-t border-slate-800 pt-2">
                  <div class="col-span-1 font-mono text-brand-400">domain</div>
                  <div class="col-span-2 text-slate-400">Optional. One of the supported domains (e.g., <code>${CONFIG.DOMAINS[0]}</code>).</div>
                </div>
              </div>

              <div>
                <div class="text-xs font-semibold text-slate-500 mb-2 uppercase">Response</div>
                <pre class="bg-slate-950 rounded-lg p-4 border border-slate-800 text-xs text-slate-300 font-mono overflow-x-auto">
{
  "address": "vixo@qubit.qzz.io",
  "secret": "a1b2c3d4..."
}</pre>
              </div>
            </div>
          </div>
        </section>

        <!-- 3. Get Messages -->
        <section>
          <div class="flex items-center gap-3 mb-4">
            <span class="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-1 rounded text-xs font-mono font-bold">GET</span>
            <h3 class="text-lg font-bold text-white">/api/messages</h3>
          </div>
          <div class="glass rounded-xl overflow-hidden">
             <div class="border-b border-slate-800 bg-slate-900/50 px-4 py-2 text-xs font-mono text-slate-400">
              Fetch inbox content
            </div>
            <div class="p-6 space-y-4">
              <p class="text-sm text-slate-300">Retrieves a list of all emails received by the address.</p>

               <div>
                <div class="text-xs font-semibold text-slate-500 mb-2 uppercase">Parameters</div>
                <div class="grid grid-cols-3 gap-4 text-sm border-t border-slate-800 pt-2 mb-2">
                  <div class="col-span-1 font-mono text-brand-400">address</div>
                  <div class="col-span-2 text-slate-400">The email address obtained from <code>/api/new</code>.</div>
                </div>
                 <div class="grid grid-cols-3 gap-4 text-sm border-t border-slate-800 pt-2">
                  <div class="col-span-1 font-mono text-brand-400">secret</div>
                  <div class="col-span-2 text-slate-400">The secret key for the address.</div>
                </div>
              </div>

              <div>
                <div class="text-xs font-semibold text-slate-500 mb-2 uppercase">Response</div>
                <pre class="bg-slate-950 rounded-lg p-4 border border-slate-800 text-xs text-slate-300 font-mono overflow-x-auto">
[
  {
    "id": "1709283-Ckjs",
    "from": "Sender &lt;sender@example.com&gt;",
    "subject": "Hello",
    "date": "2024-12-25T12:00:00Z",
    "body": "..."
  }
]</pre>
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  `);
}