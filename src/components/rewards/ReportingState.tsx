import { useEffect, useState } from "react";
import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { Button, errText } from "./kit";

export function ReportingError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return <div className="space-y-3 p-6"><p role="alert" className="text-destructive">{errText(error)}</p><Button onClick={() => { void router.invalidate(); }}>RETRY</Button></div>;
}

export function ReportingNotFound() {
  return <p className="p-6 text-muted-foreground">Report unavailable.</p>;
}

export function useReportingNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}