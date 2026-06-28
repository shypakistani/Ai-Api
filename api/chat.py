import os
import json
import requests
from urllib.parse import unquote

def handler(request):
    message = request.path.strip("/")

    if not message:
        return {
            "statusCode": 200,
            "body": json.dumps({
                "status": "online",
                "usage": "https://ai.paktcpbots.com/hello"
            })
        }

    message = unquote(message)

    r = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {os.getenv('OPENROUTER_API_KEY')}",
            "Content-Type": "application/json"
        },
        json={
            "model": "openai/gpt-4o-mini",
            "messages": [
                {"role": "user", "content": message}
            ]
        }
    )

    data = r.json()

    response = (
        data.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "No response")
    )

    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/json"
        },
        "body": json.dumps({
            "question": message,
            "response": response
        })
    }
