from http.server import BaseHTTPRequestHandler
import json
import os
import requests
from urllib.parse import unquote

API_KEY = os.getenv("OPENROUTER_API_KEY")

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            # Get everything after the /
            message = self.path.lstrip("/")
            message = unquote(message)

            if not message:
                response = {
                    "status": "online",
                    "usage": "https://your-domain.vercel.app/your-message"
                }
            else:
                r = requests.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "openai/gpt-4o-mini",
                        "messages": [
                            {
                                "role": "user",
                                "content": message
                            }
                        ]
                    },
                    timeout=30
                )

                data = r.json()

                ai = (
                    data.get("choices", [{}])[0]
                    .get("message", {})
                    .get("content", "No response")
                )

                response = {
                    "question": message,
                    "response": ai
                }

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(response).encode())

        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps({"error": str(e)}).encode()
            )
