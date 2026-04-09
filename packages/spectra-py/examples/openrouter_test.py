#!/usr/bin/env python3
"""Spectra Python SDK - Live OpenRouter Test"""

import asyncio
import os
import sys

sys.path.insert(0, ".")

from spectra import Agent, Model, openai


async def main():
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("Error: OPENROUTER_API_KEY not set")
        return

    # Use OpenRouter with base_url via config (if supported)
    # For now, set the key as environment variable
    os.environ["OPENAI_API_KEY"] = api_key

    model = openai("google/gemma-4-26b-a4b-it:free")

    config = {
        "model": {
            "provider": "openrouter",
            "id": model.id,
            "max_tokens": 4096,
        },
        "system_prompt": "You are a helpful coding assistant.",
        "tools": [],
    }

    print(f"=== Testing with {model.id} ===\n")
    agent = Agent(config)
    print("Agent created with native binding!")

    print(
        "\n--- Running: 'Write a Rust function that checks if a number is prime' ---\n"
    )

    async for event in agent.prompt(
        "Write a Rust function that checks if a number is prime. Keep it under 10 lines."
    ):
        if event.get("type") == "message_update":
            print(event.get("delta", ""), end="", flush=True)
        elif event.get("type") == "error":
            print(f"\nError: {event.get('message')}")
        elif event.get("type") == "message_end":
            print(f"\n--- Stop reason: {event.get('stop_reason')} ---")

    print("\n=== Test complete ===")


if __name__ == "__main__":
    asyncio.run(main())
