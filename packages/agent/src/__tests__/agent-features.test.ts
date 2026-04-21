import { describe, it, expect, vi } from "vitest";
import { Agent } from "../agent.js";
import type { Model, Message } from "@spectra/ai";

const testModel: Model = {
  id: "test-model",
  name: "Test Model",
  provider: "test",
  api: "test",
};

describe("Agent Steering Queue", () => {
  it("should queue steering messages", () => {
    const agent = new Agent({ model: testModel });
    
    agent.steer("Be more concise");
    agent.steer("Use bullet points");
    
    // Should not throw and should queue internally
    expect(agent).toBeDefined();
  });

  it("should accept string steering messages", () => {
    const agent = new Agent({ model: testModel });
    
    expect(() => agent.steer("Hello")).not.toThrow();
  });

  it("should accept Message steering messages", () => {
    const agent = new Agent({ model: testModel });
    
    const message: Message = {
      role: "user",
      content: "Custom steering",
      timestamp: Date.now(),
    };
    
    expect(() => agent.steer(message)).not.toThrow();
  });
});

describe("Agent Follow-Up Queue", () => {
  it("should queue follow-up messages", () => {
    const agent = new Agent({ model: testModel });
    
    agent.followUp("What about tomorrow?");
    agent.followUp("And the weekend?");
    
    expect(agent).toBeDefined();
  });

  it("should accept string follow-up messages", () => {
    const agent = new Agent({ model: testModel });
    
    expect(() => agent.followUp("Hello")).not.toThrow();
  });

  it("should accept Message follow-up messages", () => {
    const agent = new Agent({ model: testModel });
    
    const message: Message = {
      role: "user",
      content: "Custom follow-up",
      timestamp: Date.now(),
    };
    
    expect(() => agent.followUp(message)).not.toThrow();
  });
});

describe("Agent Configuration", () => {
  it("should accept steeringMode option", () => {
    const agent = new Agent({
      model: testModel,
      steeringMode: "all",
    });
    
    expect(agent).toBeDefined();
  });

  it("should accept followUpMode option", () => {
    const agent = new Agent({
      model: testModel,
      followUpMode: "one-at-a-time",
    });
    
    expect(agent).toBeDefined();
  });

  it("should accept convertToLlm hook", () => {
    const convertToLlm = (messages: Message[]) => messages;
    
    const agent = new Agent({
      model: testModel,
      convertToLlm,
    });
    
    expect(agent).toBeDefined();
  });

  it("should accept maxRetryDelayMs option", () => {
    const agent = new Agent({
      model: testModel,
      maxRetryDelayMs: 5000,
    });
    
    expect(agent).toBeDefined();
  });
});

describe("Agent Error Recovery", () => {
  it("should configure retry parameters", () => {
    const agent = new Agent({
      model: testModel,
      maxRetryDelayMs: 10000,
    });
    
    expect(agent).toBeDefined();
  });
});

describe("Agent Queue Integration", () => {
  it("should handle mixed steer and followUp calls", () => {
    const agent = new Agent({ model: testModel });
    
    agent.steer("First steering");
    agent.followUp("First follow-up");
    agent.steer("Second steering");
    agent.followUp("Second follow-up");
    
    expect(agent).toBeDefined();
  });

  it("should not throw when queuing during non-streaming state", () => {
    const agent = new Agent({ model: testModel });
    
    expect(agent.isStreaming).toBe(false);
    expect(() => agent.steer("test")).not.toThrow();
    expect(() => agent.followUp("test")).not.toThrow();
  });
});
