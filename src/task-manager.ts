import type { A2ATask, A2ATaskState, A2AMessage, A2AArtifact } from "./types.js";

export class TaskManager {
  private readonly tasks = new Map<string, A2ATask>();

  create(id: string, sessionId: string | undefined, userMessage: A2AMessage): A2ATask {
    const task: A2ATask = {
      id,
      sessionId,
      status: { state: "submitted", timestamp: new Date().toISOString() },
      history: [userMessage],
      artifacts: [],
    };
    this.tasks.set(id, task);
    return task;
  }

  get(id: string): A2ATask | undefined {
    return this.tasks.get(id);
  }

  transition(id: string, state: A2ATaskState, message?: A2AMessage): A2ATask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    task.status = { state, timestamp: new Date().toISOString(), message };
    if (message) task.history?.push(message);
    return task;
  }

  complete(id: string, responseText: string): A2ATask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    const artifact: A2AArtifact = {
      parts: [{ type: "text", text: responseText }],
      index: 0,
      lastChunk: true,
    };

    const agentMessage: A2AMessage = {
      role: "agent",
      parts: [{ type: "text", text: responseText }],
    };

    task.artifacts = [artifact];
    task.status = {
      state: "completed",
      timestamp: new Date().toISOString(),
      message: agentMessage,
    };
    task.history?.push(agentMessage);

    return task;
  }

  fail(id: string, errorMessage: string): A2ATask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    task.status = {
      state: "failed",
      timestamp: new Date().toISOString(),
      message: {
        role: "agent",
        parts: [{ type: "text", text: errorMessage }],
      },
    };

    return task;
  }

  // Trim tasks older than maxAgeMs to avoid unbounded memory growth
  prune(maxAgeMs: number = 3_600_000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, task] of this.tasks) {
      const ts = task.status.timestamp ? new Date(task.status.timestamp).getTime() : 0;
      const terminal = ["completed", "canceled", "failed"].includes(task.status.state);
      if (terminal && ts < cutoff) this.tasks.delete(id);
    }
  }
}
