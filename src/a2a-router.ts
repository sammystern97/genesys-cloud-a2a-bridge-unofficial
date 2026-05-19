import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import type { GenesysBridge } from "./genesys-bridge.js";
import { TaskManager } from "./task-manager.js";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  A2ATaskSendParams,
  A2ATaskGetParams,
  A2ATaskCancelParams,
  A2AMessage,
} from "./types.js";
import { A2A_ERROR } from "./types.js";

function ok(id: string | number, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function err(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

function extractText(message: A2AMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

export class A2ARouter {
  private readonly tasks = new TaskManager();

  constructor(private readonly bridge: GenesysBridge) {
    // Prune completed tasks hourly
    setInterval(() => this.tasks.prune(), 3_600_000);
  }

  handle = async (req: Request, res: Response): Promise<void> => {
    let rpc: JsonRpcRequest;

    try {
      rpc = req.body as JsonRpcRequest;
      if (rpc.jsonrpc !== "2.0" || !rpc.method) {
        res.json(err(null, A2A_ERROR.INVALID_REQUEST, "Invalid JSON-RPC request"));
        return;
      }
    } catch {
      res.json(err(null, A2A_ERROR.PARSE_ERROR, "Parse error"));
      return;
    }

    switch (rpc.method) {
      case "tasks/send":
        await this.handleSend(rpc, res);
        break;
      case "tasks/get":
        this.handleGet(rpc, res);
        break;
      case "tasks/cancel":
        this.handleCancel(rpc, res);
        break;
      default:
        res.json(err(rpc.id, A2A_ERROR.METHOD_NOT_FOUND, `Method not found: ${rpc.method}`));
    }
  };

  private async handleSend(rpc: JsonRpcRequest, res: Response): Promise<void> {
    const params = rpc.params as A2ATaskSendParams | undefined;
    if (!params?.message) {
      res.json(err(rpc.id, A2A_ERROR.INVALID_PARAMS, "Missing params.message"));
      return;
    }

    const taskId = params.id ?? uuidv4();
    const sessionId = params.sessionId ?? uuidv4();
    const userText = extractText(params.message);

    if (!userText) {
      res.json(err(rpc.id, A2A_ERROR.INVALID_PARAMS, "No text content in message parts"));
      return;
    }

    const task = this.tasks.create(taskId, sessionId, params.message);
    this.tasks.transition(taskId, "working");

    // Respond immediately that we're working, then resolve asynchronously.
    // A2A synchronous tasks/send should block until done, so we await here.
    try {
      const responseText = await this.bridge.sendAndAwait(taskId, sessionId, userText);
      const completed = this.tasks.complete(taskId, responseText);
      res.json(ok(rpc.id, completed));
    } catch (error) {
      const failed = this.tasks.fail(taskId, (error as Error).message);
      res.json(ok(rpc.id, failed));
    }
  }

  private handleGet(rpc: JsonRpcRequest, res: Response): void {
    const params = rpc.params as A2ATaskGetParams | undefined;
    if (!params?.id) {
      res.json(err(rpc.id, A2A_ERROR.INVALID_PARAMS, "Missing params.id"));
      return;
    }

    const task = this.tasks.get(params.id);
    if (!task) {
      res.json(err(rpc.id, A2A_ERROR.TASK_NOT_FOUND, `Task not found: ${params.id}`));
      return;
    }

    // Trim history to historyLength if requested
    const result = { ...task };
    if (params.historyLength !== undefined && result.history) {
      result.history = result.history.slice(-params.historyLength);
    }

    res.json(ok(rpc.id, result));
  }

  private handleCancel(rpc: JsonRpcRequest, res: Response): void {
    const params = rpc.params as A2ATaskCancelParams | undefined;
    if (!params?.id) {
      res.json(err(rpc.id, A2A_ERROR.INVALID_PARAMS, "Missing params.id"));
      return;
    }

    const task = this.tasks.get(params.id);
    if (!task) {
      res.json(err(rpc.id, A2A_ERROR.TASK_NOT_FOUND, `Task not found: ${params.id}`));
      return;
    }

    const terminal = ["completed", "canceled", "failed"];
    if (terminal.includes(task.status.state)) {
      res.json(err(rpc.id, A2A_ERROR.TASK_NOT_CANCELABLE, "Task is already in a terminal state"));
      return;
    }

    const canceled = this.tasks.transition(params.id, "canceled");
    res.json(ok(rpc.id, canceled));
  }
}
