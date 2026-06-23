/// <reference types="@cloudflare/workers-types" />

export interface Env {
  PRIMARY_ORIGIN: string;
  BACKUP_ORIGIN: string;
  HEALTH_CHECK_PATH?: string;
}

async function pingCheck(origin: string, path: string = '/health'): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000); // 2 second timeout for health check
    
    const response = await fetch(`${origin}${path}`, {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    return response.ok;
  } catch (err) {
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const primary = env.PRIMARY_ORIGIN || "https://api.primary.example.com";
    const backup = env.BACKUP_ORIGIN || "https://api.backup.example.com";
    const healthPath = env.HEALTH_CHECK_PATH || "/health";

    const requestUrl = new URL(request.url);

    // Default to primary
    let targetOrigin = primary;

    // We can run the ping check. In a real-world high-traffic scenario, 
    // it's better to cache this health state or rely on Cloudflare's health checks.
    // For this implementation, we do an active ping check as requested.
    const isPrimaryHealthy = await pingCheck(primary, healthPath);
    
    if (!isPrimaryHealthy) {
      console.warn(`Primary origin ${primary} is down. Rerouting to backup ${backup}`);
      targetOrigin = backup;
    }

    const targetUrl = new URL(requestUrl.pathname + requestUrl.search, targetOrigin);

    // Create a new request based on the original
    // Note: Request bodies can only be read once. If we fallback after this fetch,
    // we would need to have cloned the request. However, since the ping check
    // happens *before* consuming the request body, we only consume it once.
    const newRequest = new Request(targetUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.clone().body, // clone just in case we need to retry
      redirect: 'manual'
    });

    try {
      const response = await fetch(newRequest);
      
      // If primary returned 5xx, we can fallback here as well
      if (response.status >= 500 && targetOrigin === primary) {
        console.warn(`Primary origin ${primary} returned 5xx. Rerouting to backup ${backup}`);
        const backupUrl = new URL(requestUrl.pathname + requestUrl.search, backup);
        const backupRequest = new Request(backupUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.body, // original un-cloned body
          redirect: 'manual'
        });
        return await fetch(backupRequest);
      }

      return response;
    } catch (err) {
      if (targetOrigin === primary) {
        // Fallback to backup if fetch to primary threw an error
        console.error(`Fetch to primary origin failed. Rerouting to backup ${backup}`);
        const backupUrl = new URL(requestUrl.pathname + requestUrl.search, backup);
        const backupRequest = new Request(backupUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.body,
          redirect: 'manual'
        });
        return await fetch(backupRequest);
      }
      
      return new Response("Service Unavailable", { status: 503 });
    }
  }
} satisfies ExportedHandler<Env>;
