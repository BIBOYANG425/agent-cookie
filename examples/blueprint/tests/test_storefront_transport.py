"""Transport unit fixtures only. No real LLM/workspace acceptance is claimed."""
import json
from pathlib import Path
import sys
import unittest

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from storefront_transport import StorefrontClient, StorefrontError


class Chunks(httpx.AsyncByteStream):
    def __init__(self, parts):
        self.parts = parts

    async def __aiter__(self):
        for part in self.parts:
            yield part


class TransportTests(unittest.IsolatedAsyncioTestCase):
    def client(self, stream, *, origin="http://127.0.0.1:8000", session_user="pairwise-a"):
        requests = []

        async def handler(request):
            requests.append(request)
            if request.url.path == "/api/session":
                return httpx.Response(200, json={"session_id": "secret-chat-token", "user_id": session_user})
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=Chunks(stream))

        return StorefrontClient(origin, transport=httpx.MockTransport(handler)), requests

    async def test_explicit_subject_and_chunked_unicode_sse(self):
        body = ('event: text_delta\r\ndata: {"text": "样例"}\r\n\r\n'
                'event: extra_future_event\r\ndata: {\r\ndata: "ok": true}\r\n\r\n'
                'event: turn_complete\r\ndata: {"stop_reason":"end_turn"}\r\n\r\n').encode()
        client, requests = self.client([body[i:i+1] for i in range(len(body))])
        async with client:
            session = await client.open_session("pairwise-a")
            result = await client.chat(session, "Sample request")
        self.assertEqual(json.loads(requests[0].content), {"user_id": "pairwise-a"})
        self.assertEqual(requests[1].headers["X-Session-Id"], "secret-chat-token")
        self.assertEqual(json.loads(requests[1].content), {"message": "Sample request"})
        self.assertEqual(result.text, "样例")
        self.assertEqual(result.stop_reason, "end_turn")
        self.assertFalse(result.is_truncated)
        self.assertEqual([e.type for e in result.events], ["text_delta", "extra_future_event", "turn_complete"])
        self.assertNotIn("secret-chat-token", repr(session))

    async def test_200_error_event_is_failure(self):
        client, _ = self.client([b'event: error\ndata: {"message":"credential secret"}\n\n'])
        async with client:
            session = await client.open_session("pairwise-a")
            with self.assertRaisesRegex(StorefrontError, "upstream_error") as caught:
                await client.chat(session, "Sample")
        self.assertNotIn("credential secret", str(caught.exception))

    async def test_eof_without_turn_complete_is_failure(self):
        client, _ = self.client([b'event: text_delta\ndata: {"text":"partial"}\n\n'])
        async with client:
            session = await client.open_session("pairwise-a")
            with self.assertRaisesRegex(StorefrontError, "incomplete_turn"):
                await client.chat(session, "Sample")

    async def test_bad_json_and_non_object_are_rejected(self):
        for payload in [b'{bad', b'[]']:
            with self.subTest(payload=payload):
                client, _ = self.client([b'event: turn_complete\ndata: '+payload+b'\n\n'])
                async with client:
                    session = await client.open_session("pairwise-a")
                    with self.assertRaisesRegex(StorefrontError, "invalid_sse"):
                        await client.chat(session, "Sample")

    async def test_session_subject_must_match(self):
        client, _ = self.client([], session_user="demo-user")
        async with client:
            with self.assertRaisesRegex(StorefrontError, "session_subject_mismatch"):
                await client.open_session("pairwise-a")

    async def test_token_cannot_cross_storefronts(self):
        first, _ = self.client([])
        second, requests = self.client([], origin="http://127.0.0.1:8001")
        async with first, second:
            session = await first.open_session("pairwise-a")
            with self.assertRaisesRegex(StorefrontError, "session_origin_mismatch"):
                await second.chat(session, "Sample")
        self.assertEqual(requests, [])

    async def test_completed_turn_does_not_hide_blocked_action(self):
        client, _ = self.client([b'event: tool_result\ndata: {"tool":"save_memory","is_error":true,"status":"blocked"}\n\nevent: turn_complete\ndata: {}\n\n'])
        async with client:
            session = await client.open_session("pairwise-a")
            result = await client.chat(session, "Sample")
        self.assertTrue(result.has_failed_actions)

    async def test_turn_complete_does_not_hide_token_limit(self):
        client, _ = self.client([b'event: text_delta\ndata: {"text":"unfinished"}\n\nevent: turn_complete\ndata: {"stop_reason":"max_tokens"}\n\n'])
        async with client:
            session = await client.open_session("pairwise-a")
            result = await client.chat(session, "Sample")
        self.assertEqual(result.stop_reason, "max_tokens")
        self.assertTrue(result.is_truncated)
        self.assertFalse(result.has_failed_actions)

    async def test_redirect_does_not_forward_session_token_or_retry(self):
        requests = []

        def handler(request):
            requests.append(request)
            if request.url.path == "/api/session":
                return httpx.Response(200, json={"session_id":"secret-chat-token", "user_id":"pairwise-a"})
            return httpx.Response(307, headers={"location":"http://127.0.0.1:8001/api/chat"})

        async with StorefrontClient("http://127.0.0.1:8000", transport=httpx.MockTransport(handler)) as client:
            session = await client.open_session("pairwise-a")
            with self.assertRaisesRegex(StorefrontError, "http_307"):
                await client.chat(session, "Sample")
        self.assertEqual(len(requests), 2)


if __name__ == "__main__":
    unittest.main()
