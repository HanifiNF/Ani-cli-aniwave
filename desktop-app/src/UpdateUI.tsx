import type { UpdateStatus, UpdateInstallStatus } from "../shared/contracts";
import { Icon } from "./icons";

/** A newer release the user has yet to skip. It lights the dot on the gear, the dot in the rail, and the link beside the Settings heading. */
export const updatePending = (status?: UpdateStatus): status is UpdateStatus & { latestVersion: string } =>
  status?.state === "available" && !status.dismissed && Boolean(status.latestVersion);

/** The link beside the Settings heading; it jumps to the Updates row. */
export function UpdateNotice({ status, onJump }: { status?: UpdateStatus; onJump: () => void }) {
  if (!updatePending(status)) return null;
  return <button type="button" className="update-notice" onClick={onJump}><i aria-hidden="true" />v{status.latestVersion} available</button>;
}

/** "checked today 00:28", or the date once the check is older than today. */
function checked(timestamp?: number): string {
  if (timestamp === undefined) return "never checked";
  const at = new Date(timestamp);
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return at.toDateString() === new Date().toDateString() ? `checked today ${time}` : `checked ${at.toLocaleDateString()} ${time}`;
}

interface PanelProps {
  status?: UpdateStatus; checking: boolean; onCheck: () => void; onOpen: () => void; onSkip: () => void;
  installStatus?: UpdateInstallStatus; onDownload?: () => void; onInstall?: () => void;
}

export function UpdatePanel({ status, checking, onCheck, onOpen, onSkip, installStatus, onDownload, onInstall }: PanelProps) {
  const available = status?.state === "available" && Boolean(status.latestVersion);
  const busy = installStatus?.phase === "downloading" || installStatus?.phase === "installing";
  const ready = installStatus?.phase === "ready";
  const canDownload = available && installStatus && installStatus.mode !== "unsupported" && onDownload;
  const title = available ? `Version ${status?.latestVersion} is available`
    : status?.state === "current" ? "ANIdesktop is up to date"
    : "Application updates";
  const installing = Boolean(canDownload || ready || busy);
  const detail = !status ? "ANIdesktop will check shortly after startup."
    : status.state === "development" ? "Automatic checks are disabled while running from source."
    : available ? `You have ${status.currentVersion} · ${checked(status.checkedAt)}${status.dismissed ? " · skipped" : ""}`
    : status.state === "current" ? `Version ${status.currentVersion} · ${checked(status.checkedAt)}`
    : `${status.error ?? "Could not check for updates."} Installed v${status.currentVersion}.`;
  return <div className="group update-settings"><h3 id="settings-updates" tabIndex={-1}>Updates</h3><div className="box">
    {/* An available version is one line and one action: its title opens the release notes, a quiet skip sits beside the button. */}
    <div className="r"><span className="k">{available
      ? <button type="button" className="update-title" title="View release notes" onClick={onOpen}>{title}<Icon name="external" /></button>
      : title}<small>{detail}{status?.stale ? " Showing the last valid result." : ""}</small></span>
      <span className="v-row">
        {updatePending(status) && <button type="button" className="link" disabled={busy} aria-label={`Skip version ${status.latestVersion}`} onClick={onSkip}>skip</button>}
        {!available && <button type="button" className="btn small" disabled={checking || busy} onClick={onCheck}>{checking ? "checking…" : "check now"}</button>}
        {available && !installing && <button type="button" className="btn small primary" onClick={onOpen}>View release</button>}
        {installing && <button type="button" className="btn small primary" disabled={checking || busy} onClick={ready ? onInstall : onDownload}>
          {!ready && !busy && <Icon name="download" />}
          {installStatus?.phase === "installing" ? "Opening update…" : installStatus?.phase === "downloading" ? `Downloading ${Math.floor(installStatus.percent ?? 0)}%`
            : ready ? installStatus?.mode === "automatic" ? "Install and restart" : "Open download" : installStatus?.mode === "native" ? "Install update…" : "Download update"}
        </button>}
      </span>
    </div>
  </div>
    {status?.error && status.state !== "error" && <div className="group-note">{status.error}</div>}
    {/* How to finish installing appears once there is something to install, not beside the offer. */}
    {(ready || busy || installStatus?.error) && installStatus && <div className="group-note" role="status">
      {ready ? `Version ${installStatus.version} is ready. ` : ""}{installStatus.detail}
      {installStatus.error && <div role="alert">{installStatus.error}</div>}
    </div>}
  </div>;
}
