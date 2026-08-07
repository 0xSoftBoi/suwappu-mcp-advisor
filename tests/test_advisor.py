import json
import unittest
from unittest.mock import patch

import requests

import advisor


def json_response(body: object, status: int = 200) -> requests.Response:
    response = requests.Response()
    response.status_code = status
    response.headers["content-type"] = "application/json"
    response._content = json.dumps(body).encode("utf-8")
    response.encoding = "utf-8"
    return response


class AnalysisTests(unittest.TestCase):
    def test_flags_are_neutral_and_held_asset_grounded(self) -> None:
        portfolio = {
            "balances": [
                {
                    "symbol": "ETH",
                    "chain": "ethereum",
                    "balance": "0.25",
                    "usd_value": 900,
                },
                {
                    "symbol": "USDC",
                    "chain": "base",
                    "balance": "100",
                    "usd_value": 100,
                },
            ],
            "total_usd": 1000,
        }
        report, flags = advisor.rule_based_analysis(
            portfolio,
            {"SOL": {"usd": 100.0, "change_24h": -9.0}},
        )

        self.assertIn("DOWN: SOL -9.0% — research before acting", report)
        self.assertEqual(flags[0]["action"], "reduce_concentration")
        self.assertEqual(flags[0]["token"], "ETH")
        self.assertFalse(any(flag["token"] == "SOL" for flag in flags))


class ProtocolTests(unittest.TestCase):
    def test_modern_metadata_and_header_encoding(self) -> None:
        params = advisor.modern_request_params({"name": "get_prices"})
        self.assertEqual(advisor.MCP_PROTOCOL_VERSION, "2026-07-28")
        self.assertEqual(advisor.LEGACY_MCP_PROTOCOL_VERSION, "2025-06-18")
        self.assertEqual(
            params["_meta"]["io.modelcontextprotocol/protocolVersion"],
            "2026-07-28",
        )
        self.assertEqual(advisor.encode_mcp_header_value("get_prices"), "get_prices")
        self.assertEqual(
            advisor.encode_mcp_header_value(" padded "),
            "=?base64?IHBhZGRlZCA=?=",
        )

    @patch("advisor.requests.post")
    def test_connect_prefers_modern_discovery(self, mock_post) -> None:
        mock_post.return_value = json_response(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "resultType": "complete",
                    "supportedVersions": ["2026-07-28", "2025-06-18"],
                    "capabilities": {"tools": {}},
                    "ttlMs": 60000,
                    "cacheScope": "public",
                    "_meta": {
                        "io.modelcontextprotocol/serverInfo": {
                            "name": "Suwappu",
                            "version": "0.6.0",
                        }
                    },
                },
            }
        )

        client = advisor.McpClient(url="https://example.test/mcp")
        connected = client.connect()

        self.assertEqual(connected["era"], "modern")
        self.assertEqual(connected["protocolVersion"], "2026-07-28")
        call = mock_post.call_args
        self.assertEqual(call.kwargs["headers"]["Mcp-Method"], "server/discover")
        self.assertEqual(
            call.kwargs["json"]["params"]["_meta"][
                "io.modelcontextprotocol/protocolVersion"
            ],
            "2026-07-28",
        )

    @patch("advisor.requests.post")
    def test_connect_falls_back_to_legacy_handshake(self, mock_post) -> None:
        notification_response = requests.Response()
        notification_response.status_code = 204
        mock_post.side_effect = [
            json_response(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "error": {"code": -32601, "message": "Method not found"},
                }
            ),
            json_response(
                {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "result": {
                        "protocolVersion": "2025-06-18",
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "Legacy Suwappu", "version": "0.5.0"},
                    },
                }
            ),
            notification_response,
        ]

        client = advisor.McpClient(url="https://example.test/mcp")
        connected = client.connect()

        self.assertEqual(connected["era"], "legacy")
        self.assertEqual(connected["protocolVersion"], "2025-06-18")
        methods = [call.kwargs["json"]["method"] for call in mock_post.call_args_list]
        self.assertEqual(
            methods,
            ["server/discover", "initialize", "notifications/initialized"],
        )


if __name__ == "__main__":
    unittest.main()
