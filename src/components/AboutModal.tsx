import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Modal, type ModalAction } from "./Modal";
import { useUpdateChecker } from "../lib/updater";

export function AboutModal({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState("");
  const { state, update, progress, error, checkForUpdate, installUpdate } =
    useUpdateChecker();

  useEffect(() => {
    void getVersion().then(setVersion);
  }, []);

  const statusText = (() => {
    switch (state) {
      case "checking":
        return "Checking for updates…";
      case "up-to-date":
        return "You're up to date.";
      case "available":
        return `Version ${update?.version} is available.`;
      case "downloading":
        return `Downloading update… ${progress}%`;
      case "ready":
        return "Update ready — restarting…";
      case "error":
        return `Update check failed: ${error}`;
      default:
        return null;
    }
  })();

  const primaryActions: ModalAction[] = [];
  if (state === "available") {
    primaryActions.push({
      label: "Install & Restart",
      variant: "primary",
      onClick: () => void installUpdate(),
    });
  }
  primaryActions.push({ label: "Close", variant: "primary", onClick: onClose });

  return (
    <Modal
      title="About SA-2025 Generator"
      onClose={onClose}
      primaryActions={primaryActions}
      secondaryActions={[
        {
          label: "Check for Updates",
          onClick: () => void checkForUpdate(),
          disabled: state === "checking" || state === "downloading",
        },
      ]}
    >
      <p style={{ marginTop: 0 }}>
        <strong>SA-2025 Generator</strong>
      </p>
      <p>Version {version}</p>
      {statusText && <p style={{ color: "var(--text-muted)" }}>{statusText}</p>}
    </Modal>
  );
}
