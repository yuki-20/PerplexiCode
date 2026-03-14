/**
 * PerplexiCode Interactive Demo
 * Simulates the VS Code extension chat experience in the browser.
 */

// ── State ──
let isStreaming = false;
let currentStreamEl = null;
let currentStreamContent = '';
let streamAbort = null;
const accounts = ['Personal Pro', 'Work Account', 'Backup Free'];
let accountIndex = 0;

// ── Simulated Responses ──
const responses = {
  'Explain error: TypeError: Cannot read properties of undefined (reading \'map\')': {
    text: `This is a very common JavaScript/TypeScript error. It means you're calling \`.map()\` on a value that is \`undefined\`.

**Common causes:**

1. **API data not loaded yet** — the state is \`undefined\` before the fetch completes
2. **Wrong property path** — accessing a nested object that doesn't exist
3. **Missing default value** — no fallback for optional data

**Fix with optional chaining + default:**

\`\`\`typescript
// ❌ Crashes if items is undefined
const list = data.items.map(item => item.name);

// ✅ Safe with fallback
const list = (data?.items ?? []).map(item => item.name);
\`\`\`

**Fix in React component:**

\`\`\`tsx
function ItemList({ items }: { items?: string[] }) {
  // Guard with early return or default
  if (!items?.length) return <p>No items found.</p>;

  return (
    <ul>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
\`\`\`

**Pro tip:** Enable TypeScript strict mode and use the \`noUncheckedIndexedAccess\` compiler option to catch these at compile time.`,
    citations: ['https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors', 'https://react.dev/reference/react/hooks', 'https://www.typescriptlang.org/tsconfig#strict']
  },

  'Write a React hook for debounced search with TypeScript': {
    text: `Here's a production-ready \`useDebounceSearch\` hook:

\`\`\`typescript
import { useState, useEffect, useCallback, useRef } from 'react';

interface UseDebounceSearchOptions<T> {
  searchFn: (query: string) => Promise<T[]>;
  delay?: number;
  minLength?: number;
}

function useDebounceSearch<T>({
  searchFn,
  delay = 300,
  minLength = 2,
}: UseDebounceSearchOptions<T>) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (query.length < minLength) {
      setResults([]);
      return;
    }

    // Cancel previous request
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const timer = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await searchFn(query);
        setResults(data);
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(err);
        }
      } finally {
        setIsLoading(false);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [query, delay, minLength, searchFn]);

  return { query, setQuery, results, isLoading, error };
}
\`\`\`

**Usage:**

\`\`\`tsx
const { query, setQuery, results, isLoading } =
  useDebounceSearch({
    searchFn: (q) => fetch(\`/api/search?q=\${q}\`).then(r => r.json()),
    delay: 400,
  });
\`\`\`

This handles **abort on unmount**, **minimum length**, and **race conditions** out of the box.`,
    citations: ['https://react.dev/reference/react/useEffect', 'https://usehooks-ts.com/react-hook/use-debounce']
  },

  "What's the best way to handle authentication in Next.js 15?": {
    text: `Next.js 15 has first-class support for authentication via **Server Actions** and the **middleware** layer. Here's the recommended approach:

**1. Use NextAuth.js v5 (Auth.js)**

\`\`\`typescript
// auth.ts
import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import Credentials from 'next-auth/providers/credentials';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub,
    Credentials({
      async authorize(credentials) {
        const user = await verifyUser(credentials);
        return user ?? null;
      },
    }),
  ],
  callbacks: {
    authorized({ auth, request }) {
      return !!auth?.user; // Protect routes
    },
  },
});
\`\`\`

**2. Protect routes with Middleware**

\`\`\`typescript
// middleware.ts
export { auth as middleware } from './auth';

export const config = {
  matcher: ['/dashboard/:path*', '/api/protected/:path*'],
};
\`\`\`

**3. Access session in Server Components**

\`\`\`tsx
import { auth } from '@/auth';

export default async function Dashboard() {
  const session = await auth();
  if (!session) redirect('/login');
  return <h1>Welcome, {session.user.name}</h1>;
}
\`\`\`

**Key best practices:**
- Store sessions in **JWTs** for edge runtime compatibility
- Use **HTTP-only cookies** (handled automatically by Auth.js)
- Implement **CSRF protection** with the built-in tokens
- Add **rate limiting** on auth endpoints`,
    citations: ['https://nextjs.org/docs/app/building-your-application/authentication', 'https://authjs.dev/getting-started', 'https://next-auth.js.org/configuration/callbacks']
  },

  'Optimize this SQL query for better performance': {
    text: `Here are the most impactful SQL optimization techniques:

**1. Add proper indexes**

\`\`\`sql
-- Before: Full table scan (slow)
SELECT * FROM orders WHERE customer_id = 42 AND status = 'active';

-- Add composite index
CREATE INDEX idx_orders_customer_status
  ON orders(customer_id, status);
\`\`\`

**2. Avoid SELECT ***

\`\`\`sql
-- ❌ Fetches all columns
SELECT * FROM users JOIN orders ON users.id = orders.user_id;

-- ✅ Only what you need
SELECT u.name, u.email, o.total, o.created_at
FROM users u
JOIN orders o ON u.id = o.user_id;
\`\`\`

**3. Use EXISTS instead of IN for subqueries**

\`\`\`sql
-- ❌ Slower with large datasets
SELECT * FROM products WHERE id IN (SELECT product_id FROM order_items);

-- ✅ EXISTS stops at first match
SELECT * FROM products p
WHERE EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = p.id);
\`\`\`

**4. Use EXPLAIN ANALYZE**

\`\`\`sql
EXPLAIN ANALYZE
SELECT u.name, COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
GROUP BY u.id
HAVING COUNT(o.id) > 5;
\`\`\`

Look for **Seq Scan** (add index), **Nested Loop** (consider JOIN type), and **Sort** operations (add ORDER BY index).`,
    citations: ['https://use-the-index-luke.com/', 'https://www.postgresql.org/docs/current/using-explain.html']
  },

  'default': {
    text: `Great question! Let me help you with that.

Here's a quick overview of what I can do:

- **Explain code** — paste any snippet and I'll break it down
- **Debug errors** — share error messages for solutions
- **Write code** — describe what you need
- **Optimize** — I'll suggest performance improvements
- **Search docs** — real-time web search for latest info

Feel free to ask anything related to your codebase. I can see your currently open file and project structure for contextual answers.`,
    citations: ['https://docs.perplexity.ai']
  }
};

// ── DOM Refs ──
const messagesContainer = document.getElementById('messages-container');
const messagesList = document.getElementById('messages-list');
const welcomeScreen = document.getElementById('welcome-screen');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const sendIcon = document.getElementById('send-icon');
const newChatBtn = document.getElementById('new-chat-btn');
const statusbarModel = document.getElementById('statusbar-model');
const modelSelector = document.getElementById('model-selector');

// ── Init ──
function init() {
  messageInput.addEventListener('input', autoResize);
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
  sendBtn.addEventListener('click', handleSend);
  newChatBtn.addEventListener('click', handleNewChat);
  modelSelector.addEventListener('change', () => {
    const label = modelSelector.options[modelSelector.selectedIndex].text;
    statusbarModel.textContent = `✦ ${label} · 2/3`;
  });

  document.querySelectorAll('.quick-action-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action) {
        messageInput.value = action;
        handleSend();
      }
    });
  });

  renderCodeEditor();
}

function autoResize() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 80) + 'px';
}

function handleNewChat() {
  messagesList.innerHTML = '';
  welcomeScreen.classList.remove('hidden');
  isStreaming = false;
  updateSendButton();
}

function handleSend() {
  if (isStreaming) {
    stopStreaming();
    return;
  }
  const text = messageInput.value.trim();
  if (!text) return;
  messageInput.value = '';
  messageInput.style.height = 'auto';
  sendMessage(text);
}

function sendMessage(text) {
  welcomeScreen.classList.add('hidden');
  appendUserMessage(text);

  const account = accounts[accountIndex % accounts.length];
  accountIndex++;

  const response = responses[text] || responses['default'];

  // Show streaming
  isStreaming = true;
  updateSendButton();
  statusbarModel.innerHTML = `<span style="animation: spin 1s linear infinite; display:inline-block">⟳</span> ${account}...`;
  appendAssistantShell(account);

  // Simulate streaming
  streamResponse(response.text, response.citations, account);
}

function streamResponse(text, citations, account) {
  currentStreamContent = '';
  let charIndex = 0;
  const speed = 8; // ms per char

  const contentEl = document.getElementById('streaming-content');
  if (!contentEl) return;

  function tick() {
    if (!isStreaming) return;

    const chunkSize = Math.floor(Math.random() * 4) + 2;
    const chunk = text.slice(charIndex, charIndex + chunkSize);
    currentStreamContent += chunk;
    charIndex += chunkSize;

    contentEl.innerHTML = renderMarkdown(currentStreamContent) +
      '<span class="streaming-indicator"><span class="streaming-dot"></span><span class="streaming-dot"></span><span class="streaming-dot"></span></span>';
    scrollToBottom();

    if (charIndex < text.length) {
      streamAbort = setTimeout(tick, speed);
    } else {
      // Done
      isStreaming = false;
      updateSendButton();
      const label = modelSelector.options[modelSelector.selectedIndex].text;
      statusbarModel.textContent = `✦ ${label} · 2/3`;
      contentEl.innerHTML = renderMarkdown(text);
      contentEl.removeAttribute('id');
      addCodeActions(contentEl);
      if (citations && citations.length) {
        renderCitations(contentEl, citations);
      }

      const msgEl = document.getElementById('streaming-message');
      if (msgEl) msgEl.removeAttribute('id');

      scrollToBottom();
    }
  }

  setTimeout(tick, 600); // Initial delay
}

function stopStreaming() {
  isStreaming = false;
  if (streamAbort) clearTimeout(streamAbort);
  updateSendButton();
  const label = modelSelector.options[modelSelector.selectedIndex].text;
  statusbarModel.textContent = `✦ ${label} · 2/3`;

  const contentEl = document.getElementById('streaming-content');
  if (contentEl) {
    contentEl.innerHTML = renderMarkdown(currentStreamContent);
    contentEl.removeAttribute('id');
    addCodeActions(contentEl);
  }
  const msgEl = document.getElementById('streaming-message');
  if (msgEl) msgEl.removeAttribute('id');
}

function updateSendButton() {
  if (isStreaming) {
    sendIcon.textContent = '■';
    sendBtn.classList.add('stop');
    sendBtn.title = 'Stop';
  } else {
    sendIcon.textContent = '➤';
    sendBtn.classList.remove('stop');
    sendBtn.title = 'Send';
  }
}

// ── Message Rendering ──
function appendUserMessage(text) {
  const el = document.createElement('div');
  el.className = 'message user';
  el.innerHTML = `
    <div class="message-role"><span>You</span></div>
    <div class="message-content">${escapeHtml(text)}</div>
  `;
  messagesList.appendChild(el);
  scrollToBottom();
}

function appendAssistantShell(account) {
  const el = document.createElement('div');
  el.className = 'message assistant';
  el.id = 'streaming-message';
  el.innerHTML = `
    <div class="message-role">
      <span>✦ PerplexiCode</span>
      <span class="account-badge">${escapeHtml(account)}</span>
    </div>
    <div class="message-content" id="streaming-content">
      <span class="streaming-indicator">
        <span class="streaming-dot"></span>
        <span class="streaming-dot"></span>
        <span class="streaming-dot"></span>
      </span>
    </div>
  `;
  messagesList.appendChild(el);
  scrollToBottom();
}

function renderCitations(container, citations) {
  const el = document.createElement('div');
  el.className = 'citations';
  el.innerHTML = `
    <div class="citations-title">Sources</div>
    ${citations.map((url, i) => `
      <a class="citation-item" href="${url}" target="_blank" rel="noopener">
        <span class="citation-num">${i + 1}</span>
        <span class="citation-url">${extractDomain(url)}</span>
      </a>
    `).join('')}
  `;
  container.appendChild(el);
}

// ── Code Actions ──
function addCodeActions(container) {
  container.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code');
    if (!code) return;
    const codeText = code.textContent || '';
    const langClass = Array.from(code.classList).find(c => c.startsWith('language-'));
    const lang = langClass ? langClass.replace('language-', '') : '';

    const header = document.createElement('div');
    header.className = 'code-block-header';
    header.innerHTML = `
      <span class="code-lang">${lang || 'code'}</span>
      <div class="code-actions">
        <button class="code-action-btn copy-btn">Copy</button>
        <button class="code-action-btn insert-btn">Insert</button>
      </div>
    `;
    pre.insertBefore(header, pre.firstChild);

    header.querySelector('.copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(codeText).then(() => {
        const btn = header.querySelector('.copy-btn');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      });
    });
    header.querySelector('.insert-btn').addEventListener('click', () => {
      alert('In VS Code, this inserts the code at your cursor position.');
    });
  });
}

// ── Markdown ──
function renderMarkdown(text) {
  let html = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code class="language-${lang || ''}">${escapeHtml(code.trim())}</code></pre>`
  );
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, '<ul>$&</ul>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  if (!html.startsWith('<')) html = `<p>${html}</p>`;
  return html;
}

// ── Code Editor ──
function renderCodeEditor() {
  const code = [
    '<span class="cm">// app.ts — PerplexiCode Extension</span>',
    '<span class="kw">import</span> * <span class="kw">as</span> vscode <span class="kw">from</span> <span class="str">\'vscode\'</span>;',
    '<span class="kw">import</span> { <span class="tp">PerplexityWebClient</span> } <span class="kw">from</span> <span class="str">\'./api/perplexityClient\'</span>;',
    '<span class="kw">import</span> { <span class="tp">AccountManager</span> } <span class="kw">from</span> <span class="str">\'./storage/accountManager\'</span>;',
    '<span class="kw">import</span> { <span class="tp">RotationEngine</span> } <span class="kw">from</span> <span class="str">\'./api/rotationEngine\'</span>;',
    '',
    '<span class="kw">export async function</span> <span class="fn">activate</span>(ctx: <span class="tp">vscode.ExtensionContext</span>) {',
    '  <span class="cm">// Initialize multi-account manager</span>',
    '  <span class="kw">const</span> accounts = <span class="kw">new</span> <span class="tp">AccountManager</span>(ctx.globalState, ctx.secrets);',
    '  <span class="kw">await</span> accounts.<span class="fn">initialize</span>();',
    '',
    '  <span class="cm">// Configure rotation engine</span>',
    '  <span class="kw">const</span> engine = <span class="kw">new</span> <span class="tp">RotationEngine</span>();',
    '  engine.<span class="fn">setStrategy</span>(<span class="str">\'round-robin\'</span>);',
    '',
    '  <span class="cm">// Select best account for query</span>',
    '  <span class="kw">const</span> account = engine.<span class="fn">selectAccount</span>(accounts.<span class="fn">getAccounts</span>());',
    '',
    '  <span class="kw">if</span> (account) {',
    '    <span class="kw">const</span> client = <span class="kw">new</span> <span class="tp">PerplexityWebClient</span>(',
    '      account.sessionToken,',
    '      account.csrfToken',
    '    );',
    '',
    '    <span class="cm">// Stream response with auto-failover</span>',
    '    client.<span class="fn">streamQuery</span>(<span class="str">\'Explain this code\'</span>, <span class="str">\'turbo\'</span>, {',
    '      <span class="fn">onChunk</span>: (text) => panel.<span class="fn">appendText</span>(text),',
    '      <span class="fn">onDone</span>: () => engine.<span class="fn">markUsed</span>(account),',
    '      <span class="fn">onError</span>: (err) => {',
    '        engine.<span class="fn">markFailed</span>(account, <span class="kw">true</span>);',
    '        <span class="cm">// Auto-failover to next account</span>',
    '        <span class="kw">const</span> next = engine.<span class="fn">getFailoverAccount</span>(allAccounts, account.id);',
    '        <span class="kw">if</span> (next) <span class="fn">retryWith</span>(next);',
    '      },',
    '    });',
    '  }',
    '}',
  ];

  const lineNums = document.getElementById('line-numbers');
  const editor = document.getElementById('code-editor');

  lineNums.innerHTML = code.map((_, i) => i + 1).join('\n');
  editor.innerHTML = code.join('\n');
}

// ── Helpers ──
function escapeHtml(text) {
  const el = document.createElement('div');
  el.textContent = text;
  return el.innerHTML;
}

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

// ── Animations for status bar spin ──
const style = document.createElement('style');
style.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
document.head.appendChild(style);

// ── Start ──
init();
