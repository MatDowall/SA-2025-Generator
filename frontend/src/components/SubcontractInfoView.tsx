import { useState } from "react";
import type { Project, Subcontractor } from "../api";
import { TabBar } from "./TabBar";
import { ContractInfoForm } from "./ContractInfoForm";
import { SubcontractorDetailsGrid } from "./SubcontractorDetailsGrid";
import { TpCompaniesGrid } from "./TpCompaniesGrid";
import "./SubcontractInfoView.css";

type SubTab = "contract-info" | "subcontractor-details" | "tp-companies";

export function SubcontractInfoView({
  project,
  subs,
  onCreateSubcontractor,
  onRenameSubcontractor,
  onDeleteSubcontractor,
  onChanged,
}: {
  project: Project | null;
  subs: Subcontractor[];
  onCreateSubcontractor: (
    name: string,
    initialGridValues?: Record<string, string>,
  ) => Promise<Subcontractor>;
  onRenameSubcontractor: (id: number, name: string) => Promise<void>;
  onDeleteSubcontractor: (sub: Subcontractor) => void;
  onChanged: () => void;
}) {
  const [subTab, setSubTab] = useState<SubTab>("contract-info");

  return (
    <div className="subinfo">
      <TabBar
        tabs={[
          { key: "contract-info", label: "Contract Info" },
          { key: "subcontractor-details", label: "Subcontractor Details" },
          { key: "tp-companies", label: "TP Companies" },
        ]}
        active={subTab}
        onSelect={setSubTab}
      />

      <div className="subinfo__body">
        {subTab === "contract-info" && (
          <ContractInfoForm project={project} onChanged={onChanged} />
        )}

        {subTab === "subcontractor-details" && (
          <SubcontractorDetailsGrid
            project={project}
            subs={subs}
            onCreateSubcontractor={onCreateSubcontractor}
            onRenameSubcontractor={onRenameSubcontractor}
            onDeleteSubcontractor={onDeleteSubcontractor}
            onChanged={onChanged}
          />
        )}

        {subTab === "tp-companies" && <TpCompaniesGrid />}
      </div>
    </div>
  );
}
