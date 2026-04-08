#!/usr/bin/env python3
"""Spectra Python SDK Example"""

import asyncio
from spectra import Agent, Model, ModelConfig, anthropic, openai, get_model


async def main():
    print("=== Spectra Python SDK Example ===\n")

    # Create models
    print("=== Models ===")
    model1 = get_model("anthropic", "claude-sonnet-4-5", ModelConfig(max_tokens=4096))
    print(f"  Model: {model1.provider}/{model1.id}")

    model2 = anthropic("claude-haiku-3-5", ModelConfig(temperature=0.7))
    print(f"  Model (factory): {model2.provider}/{model2.id}")

    model3 = openai("gpt-4o")
    print(f"  Model (factory): {model3.provider}/{model3.id}")

    # Create agent config
    print("\n=== Agent Config ===")
    config = {
        "model": {
            "provider": model1.provider,
            "id": model1.id,
            "max_tokens": model1.config.max_tokens,
        },
        "system_prompt": "You are a helpful coding assistant.",
        "tools": [],
    }
    print(f"  Model: {config['model']['id']}")
    print(f"  System prompt: {config['system_prompt']}")

    # Create agent
    print("\n=== Agent ===")
    agent = Agent(config)
    print("  Agent created successfully!")

    # Run agent
    print("\n=== Running Agent ===")
    print(
        "  Native binding:",
        "available" if agent._agent else "NOT available (run 'maturin develop')",
    )
    print("\n  Stream events:")

    async for event in agent.prompt("Hello, world!"):
        print(f"    {event}")

    print("\n=== Example complete ===")


if __name__ == "__main__":
    asyncio.run(main())
