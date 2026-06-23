import { Modal } from "./Modal";

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = "Delete",
  danger = true,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={420}
      secondaryActions={[{ label: "Cancel", onClick: onClose }]}
      primaryActions={[
        {
          label: confirmLabel,
          variant: danger ? "danger" : "primary",
          onClick: onConfirm,
        },
      ]}
    >
      <p style={{ margin: 0 }}>{message}</p>
    </Modal>
  );
}
