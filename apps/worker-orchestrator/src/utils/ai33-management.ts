const AI33_BASE_URL = "https://api.ai33.pro";

export type AI33ServiceStatus =
  | "good"
  | "degraded"
  | "overloaded"
  | "ok"
  | "maintenance";

export interface AI33HealthData {
  elevenlabs: AI33ServiceStatus;
  minimax: AI33ServiceStatus;
  imagen?: AI33ServiceStatus;
  imagen_is_down?: boolean;
  veo3?: AI33ServiceStatus;
  veo3_is_down?: boolean;
}

export interface AI33Task {
  id: string;
  created_at: string;
  status: "doing" | "done" | "error";
  error_message: string | null;
  credit_cost: number;
  type: string;
  progress: number;
  metadata: Record<string, unknown>;
}

export interface AI33TaskList {
  success: boolean;
  data: AI33Task[];
  page: number;
  limit: number;
  total: number;
}

export async function checkHealth(apiKey: string): Promise<AI33HealthData> {
  const response = await fetch(`${AI33_BASE_URL}/v1/health-check`, {
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
  });
  if (!response.ok) {
    throw new Error(`AI33 health check failed: ${response.status}`);
  }
  const data = (await response.json()) as {
    success: boolean;
    data: AI33HealthData;
  };
  if (!data.success)
    throw new Error("AI33 health check returned success: false");
  return data.data;
}

export async function listTasks(
  apiKey: string,
  page = 1,
  limit = 20,
  type?: string,
): Promise<AI33TaskList> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (type) params.set("type", type);
  const response = await fetch(`${AI33_BASE_URL}/v1/tasks?${params}`, {
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
  });
  if (!response.ok)
    throw new Error(`AI33 list tasks failed: ${response.status}`);
  return response.json() as Promise<AI33TaskList>;
}

export async function deleteTask(
  apiKey: string,
  taskIds: string[],
): Promise<{ success: boolean; refund_credits: number }> {
  const response = await fetch(`${AI33_BASE_URL}/v1/task/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
    body: JSON.stringify({ task_ids: taskIds }),
  });
  if (!response.ok)
    throw new Error(`AI33 delete task failed: ${response.status}`);
  return response.json() as Promise<{
    success: boolean;
    refund_credits: number;
  }>;
}

export async function getCredits(
  apiKey: string,
): Promise<{ success: boolean; credits: number }> {
  const response = await fetch(`${AI33_BASE_URL}/v1/credits`, {
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
  });
  if (!response.ok)
    throw new Error(`AI33 get credits failed: ${response.status}`);
  return response.json() as Promise<{ success: boolean; credits: number }>;
}
