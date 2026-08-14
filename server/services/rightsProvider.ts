/**
 * Pluggable Rights Provider. Domain evaluation lives in shared/commercialRights.ts.
 * Providers only collect evidence; they never guess a license and never treat
 * a failed lookup as "probably fine".
 */
import {
  parseLicenseText,
  type ParsedLicense,
  type RightsSourceType,
} from "../../shared/commercialRights";

export interface RightsProviderRequest {
  sourceType: RightsSourceType;
  sourceUrl?: string | null;
  licenseText?: string | null;
  providerHint?: string | null;
}

export interface RightsProviderResult {
  providerId: string;
  license: ParsedLicense | null;
  failed: boolean;
  failureReason?: string;
}

export interface RightsProvider {
  readonly id: string;
  supports(request: RightsProviderRequest): boolean;
  resolveLicense(request: RightsProviderRequest): Promise<RightsProviderResult>;
}

const PUBLIC_LICENSE_HOSTS = new Set([
  "creativecommons.org",
  "www.creativecommons.org",
]);

export function isPublicLicenseUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && PUBLIC_LICENSE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/** Built-in: parse a user-supplied snapshot or a known public CC URL. Never scrape logins. */
export class SnapshotLicenseProvider implements RightsProvider {
  readonly id = "snapshot";

  supports(request: RightsProviderRequest): boolean {
    return Boolean(request.licenseText) || isPublicLicenseUrl(request.sourceUrl);
  }

  async resolveLicense(request: RightsProviderRequest): Promise<RightsProviderResult> {
    if (request.licenseText) {
      return {
        providerId: this.id,
        license: parseLicenseText({ text: request.licenseText, url: request.sourceUrl ?? null }),
        failed: false,
      };
    }
    if (isPublicLicenseUrl(request.sourceUrl)) {
      return {
        providerId: this.id,
        license: parseLicenseText({ url: request.sourceUrl }),
        failed: false,
      };
    }
    return { providerId: this.id, license: null, failed: false };
  }
}

/** Official-looking stock/web URLs without a snapshot stay failed=true → UNKNOWN. */
export class UnresolvedRemoteProvider implements RightsProvider {
  readonly id = "unresolved-remote";

  supports(request: RightsProviderRequest): boolean {
    return Boolean(request.sourceUrl) && !request.licenseText && !isPublicLicenseUrl(request.sourceUrl);
  }

  async resolveLicense(request: RightsProviderRequest): Promise<RightsProviderResult> {
    return {
      providerId: this.id,
      license: null,
      failed: true,
      failureReason: `不會抓取未公開授權頁（${request.sourceUrl}）。請貼上授權文字或購買證明。`,
    };
  }
}

export class TimeoutRightsProvider implements RightsProvider {
  readonly id = "timeout-stub";
  constructor(private readonly shouldTimeout: boolean) {}

  supports(): boolean {
    return this.shouldTimeout;
  }

  async resolveLicense(): Promise<RightsProviderResult> {
    return { providerId: this.id, license: null, failed: true, failureReason: "授權來源逾時" };
  }
}

const defaultProviders: RightsProvider[] = [
  new SnapshotLicenseProvider(),
  new UnresolvedRemoteProvider(),
];

export async function resolveLicenseWithProviders(
  request: RightsProviderRequest,
  providers: RightsProvider[] = defaultProviders,
): Promise<RightsProviderResult> {
  for (const provider of providers) {
    if (!provider.supports(request)) continue;
    try {
      const result = await provider.resolveLicense(request);
      if (result.failed || result.license) return result;
    } catch (error) {
      return {
        providerId: provider.id,
        license: null,
        failed: true,
        failureReason: error instanceof Error ? error.message : "授權來源失敗",
      };
    }
  }
  return { providerId: "none", license: null, failed: false };
}
