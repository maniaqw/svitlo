"use client";
import { useEffect, useState } from "react";
import LaunchScreen from "./miniapp/LaunchScreen";
export default function Page() {
  const [Component, setComponent] = useState<React.ComponentType | null>(null);
  const [error,setError]=useState("");
  useEffect(() => {
    void import("./miniapp/App").then((module) =>
      setComponent(() => module.default),
    ).catch(()=>setError("Перевірте з’єднання та повторіть спробу."));
  }, []);
  return Component ? (
    <Component />
  ) : (
    <LaunchScreen error={error} retry={()=>window.location.reload()}/>
  );
}
