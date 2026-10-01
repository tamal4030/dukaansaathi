import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../lib/i18n';
import { ToastProvider } from '../providers/ToastProvider';
import { FeaturesProvider } from '../providers/FeaturesProvider';
import { AuthProvider } from '../providers/AuthProvider';
import { CartProvider } from '../providers/CartProvider';
import { ChatPanel } from './ChatPanel';

/**
 * Regression test for the first-message authorization bug.
 *
 * The defect: ensureConversation() stored the server-issued guest token with
 * setState, then send() immediately read it from its closure. On the very first
 * message the value was still null, so the POST went out without the
 * X-Guest-Token header and the backend answered
 * "You do not have access to this conversation".
 *
 * These tests drive the real component through a stubbed fetch and assert on
 * the actual outgoing request headers. No real network call is made.
 */

const GUEST_TOKEN = 'test-guest-token-not-a-real-secret';
const CONVERSATION_ID = 'conv-0001';

interface CapturedRequest {
  url: string;
  method: string;
  guestToken: string | null;
  body: unknown;
}

let requests: CapturedRequest[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  requests = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers = new Headers(init?.headers ?? {});
      const rawBody = typeof init?.body === 'string' ? init.body : null;

      requests.push({
        url,
        method,
        guestToken: headers.get('X-Guest-Token'),
        body: rawBody ? JSON.parse(rawBody) : null,
      });

      // POST /conversations -> issue a conversation plus its guest token.
      if (url.endsWith('/api/conversations') && method === 'POST') {
        return jsonResponse(
          {
            conversation: { id: CONVERSATION_ID, businessId: 'biz-0001', status: 'OPEN', customerLocale: 'bn' },
            guestToken: GUEST_TOKEN,
            business: { id: 'biz-0001', name: 'Sharma Kirana', slug: 'sharma' },
          },
          201,
        );
      }

      // POST /conversations/:id/messages -> enforce the token, like the backend.
      if (url.includes(`/conversations/${CONVERSATION_ID}/messages`)) {
        if (headers.get('X-Guest-Token') !== GUEST_TOKEN) {
          return jsonResponse(
            { error: { code: 'FORBIDDEN', message: 'You do not have access to this conversation.' } },
            403,
          );
        }
        return jsonResponse(
          {
            messages: [
              { id: 'm1', role: 'CUSTOMER', content: 'হ্যালো', language: 'bn', source: 'TEXT', createdAt: new Date().toISOString() },
              { id: 'm2', role: 'ASSISTANT', content: 'হ্যাঁ, চাল আছে।', language: 'bn', source: 'TEXT', createdAt: new Date().toISOString() },
            ],
            assistant: { reply: 'হ্যাঁ, চাল আছে।', language: 'bn', proposals: [], available: true, notice: null },
            business: { id: 'biz-0001', name: 'Sharma Kirana', slug: 'sharma', openState: 'open' },
          },
          201,
        );
      }

      // Conversation feedback also requires the token.
      if (url.includes(`/conversations/${CONVERSATION_ID}/feedback`)) {
        if (headers.get('X-Guest-Token') !== GUEST_TOKEN) {
          return jsonResponse({ error: { code: 'FORBIDDEN', message: 'You do not have access.' } }, 403);
        }
        return jsonResponse({ feedback: { id: 'f1', rating: 5 } }, 201);
      }

      return jsonResponse({}, 200);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function renderChat() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <ToastProvider>
          <FeaturesProvider>
            <AuthProvider>
              <CartProvider>
                <ChatPanel businessId="biz-0001" businessName="Sharma Kirana" />
              </CartProvider>
            </AuthProvider>
          </FeaturesProvider>
        </ToastProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe('first message carries the server-issued guest token', () => {
  it('sends X-Guest-Token on the very first POST and receives a reply', async () => {
    const user = userEvent.setup();
    renderChat();

    // No conversation is created merely by opening the panel.
    expect(requests.filter((r) => r.url.endsWith('/api/conversations'))).toHaveLength(0);

    const input = screen.getByLabelText(/Type your question/i);
    await user.type(input, 'হ্যালো');
    await user.click(screen.getByRole('button', { name: /^Send$/i }));

    await waitFor(() => {
      expect(requests.some((r) => r.url.includes('/messages'))).toBe(true);
    });

    const messageRequest = requests.find((r) => r.url.includes('/messages'))!;
    // The bug produced null here, and the backend answered 403.
    expect(messageRequest.guestToken).toBe(GUEST_TOKEN);

    // And the assistant reply is rendered, proving the request succeeded.
    expect(await screen.findByText('হ্যাঁ, চাল আছে।')).toBeInTheDocument();
    expect(screen.queryByText(/do not have access/i)).not.toBeInTheDocument();
  });

  it('creates exactly one conversation for the first message', async () => {
    const user = userEvent.setup();
    renderChat();

    await user.type(screen.getByLabelText(/Type your question/i), 'হ্যালো');
    await user.click(screen.getByRole('button', { name: /^Send$/i }));

    await waitFor(() => {
      expect(requests.some((r) => r.url.includes('/messages'))).toBe(true);
    });

    const creations = requests.filter((r) => r.url.endsWith('/api/conversations'));
    expect(creations).toHaveLength(1);
  });

  it('keeps sending the token on later messages without a second conversation', async () => {
    const user = userEvent.setup();
    renderChat();

    const input = screen.getByLabelText(/Type your question/i);
    await user.type(input, 'প্রথম প্রশ্ন');
    await user.click(screen.getByRole('button', { name: /^Send$/i }));
    await waitFor(() => expect(requests.some((r) => r.url.includes('/messages'))).toBe(true));

    await user.type(input, 'দ্বিতীয় প্রশ্ন');
    await user.click(screen.getByRole('button', { name: /^Send$/i }));

    await waitFor(() => {
      expect(requests.filter((r) => r.url.includes('/messages')).length).toBe(2);
    });

    const messages = requests.filter((r) => r.url.includes('/messages'));
    expect(messages.every((r) => r.guestToken === GUEST_TOKEN)).toBe(true);
    // Still only one conversation was ever created.
    expect(requests.filter((r) => r.url.endsWith('/api/conversations'))).toHaveLength(1);
  });

  it('sends the token with conversation feedback', async () => {
    const user = userEvent.setup();
    renderChat();

    await user.type(screen.getByLabelText(/Type your question/i), 'হ্যালো');
    await user.click(screen.getByRole('button', { name: /^Send$/i }));
    await waitFor(() => expect(requests.some((r) => r.url.includes('/messages'))).toBe(true));

    // The feedback stars appear once there are at least two turns.
    const star = await screen.findByRole('button', { name: '5' });
    await user.click(star);

    await waitFor(() => {
      expect(requests.some((r) => r.url.includes('/feedback'))).toBe(true);
    });
    const feedbackRequest = requests.find((r) => r.url.includes('/feedback'))!;
    expect(feedbackRequest.guestToken).toBe(GUEST_TOKEN);
  });

  it('does not put the token in the request body or the URL', async () => {
    const user = userEvent.setup();
    renderChat();

    await user.type(screen.getByLabelText(/Type your question/i), 'হ্যালো');
    await user.click(screen.getByRole('button', { name: /^Send$/i }));
    await waitFor(() => expect(requests.some((r) => r.url.includes('/messages'))).toBe(true));

    const messageRequest = requests.find((r) => r.url.includes('/messages'))!;
    // A guest token in a URL would leak through logs and referrers.
    expect(messageRequest.url).not.toContain(GUEST_TOKEN);
    expect(JSON.stringify(messageRequest.body ?? {})).not.toContain(GUEST_TOKEN);
  });
});
