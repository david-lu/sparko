import type { ReactNode } from "react";

type PanelBodyProps = {
  children: ReactNode;
  className?: string;
};

export function PanelBody(props: PanelBodyProps) {
  const { children, className = "inspectorPanelBody" } = props;

  return <div className={className}>{children}</div>;
}
