"""Run only against the documented loopback mock demo. No keys or real signatures."""
import base64
import json
import time
import urllib.error
import urllib.request

ORIGIN = "http://127.0.0.1:3000"


def request(path, headers=None):
    try:
        return urllib.request.urlopen(urllib.request.Request(ORIGIN + path, headers=headers or {}), timeout=10)
    except urllib.error.HTTPError as response:
        return response


with request("/health") as response:
    health = json.load(response)
    if response.status != 200 or health.get("paymentRail") != "loopback_mock":
        raise SystemExit("Refusing: the seller must report loopback_mock mode")

with request("/quote") as response:
    assert response.status == 402, response.status
    required = json.loads(base64.b64decode(response.headers["payment-required"]))
    offer = required["accepts"][0]
    assert offer["extra"]["name"] == "GatewayWalletBatched"
    assert offer["network"] == "eip155:5042002"
    print("PASS unpaid HTTP request returns Gateway 402")

now = int(time.time())
payment = {
    "x402Version": 2,
    "resource": required["resource"],
    "accepted": offer,
    "payload": {
        "signature": "0xSYNTHETIC_NOT_A_SIGNATURE",
        "authorization": {
            "from": "0x2222222222222222222222222222222222222222",
            "to": offer["payTo"],
            "value": offer["amount"],
            "validAfter": str(now - 600),
            "validBefore": str(now + offer["maxTimeoutSeconds"]),
            "nonce": "0x" + "00" * 32,
        },
    },
}
header = base64.b64encode(json.dumps(payment).encode()).decode()
with request("/quote", {"payment-signature": header}) as response:
    content = json.load(response)
    assert response.status == 200, (response.status, content)
    receipt = json.loads(base64.b64decode(response.headers["payment-response"]))
    assert content["payment"]["status"] == "accepted"
    assert content["payment"]["transferId"] == receipt["transaction"]
    assert response.headers["cache-control"] == "no-store"
    print("PASS synthetic mock acceptance returns quote and UUID receipt")
    print("No live payment, signature verification, or onchain settlement occurred.")
