import { Logger } from "../util/log.js";

export interface SlackStatusProfile {
  status_text: string;
  status_emoji: string;
  status_expiration: number;
}

export interface StatusClient {
  getProfile(): Promise<SlackStatusProfile>;
  setProfile(profile: SlackStatusProfile): Promise<void>;
  clearStatus(): Promise<void>;
}

export interface SlackClientOptions {
  token: string;
  logger: Logger;
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
}

interface SlackApiResponse<T> {
  ok: boolean;
  error?: string;
  profile?: T;
}

export class SlackApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
  }
}

export class SlackClient implements StatusClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: SlackClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getProfile(): Promise<SlackStatusProfile> {
    const response = await this.callApi<SlackStatusProfile>("users.profile.get");
    if (!response.profile) {
      throw new SlackApiError("Slack users.profile.get returned no profile");
    }

    return response.profile;
  }

  async setProfile(profile: SlackStatusProfile): Promise<void> {
    await this.callApi("users.profile.set", {
      profile
    });
  }

  async clearStatus(): Promise<void> {
    await this.setProfile({
      status_text: "",
      status_emoji: "",
      status_expiration: 0
    });
  }

  private async callApi<T>(
    method: string,
    body?: Record<string, unknown>
  ): Promise<SlackApiResponse<T>> {
    const response = await this.fetchImpl(`${this.options.apiBaseUrl}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    if (!response.ok) {
      throw new SlackApiError(`Slack HTTP error ${response.status} on ${method}`);
    }

    const data = (await response.json()) as SlackApiResponse<T>;
    if (!data.ok) {
      this.options.logger.error("Slack API returned an error", { method, error: data.error });
      throw new SlackApiError(`Slack API error on ${method}: ${data.error ?? "unknown"}`, data.error);
    }

    return data;
  }
}
