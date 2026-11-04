"use client";
import { useEffect, useState } from "react";

export default function LaunchScreen({error,retry}:{error?:string;retry?:()=>void}) {
  const [slow,setSlow]=useState(false);
  useEffect(()=>{
    const id=setTimeout(()=>setSlow(true),Math.max(0,450-performance.now()));
    return ()=>clearTimeout(id);
  },[]);
  return <main className={`boot-screen ${slow&&!error?"boot-animated":""}`} aria-busy={!error}>
    <div className="boot-symbol" aria-hidden="true"><span className="boot-orbit"/><svg viewBox="0 0 64 64" fill="none"><path d="M36 8 17 35h14l-3 21 19-29H33l3-19Z" fill="currentColor"/></svg></div>
    <strong>світло<span>.</span></strong>
    <div className="boot-caption" role={error?"alert":"status"} aria-live="polite">
      <p>{error?"Не вдалося завантажити застосунок":slow?"Готуємо ваш графік…":""}</p>
      {error?<><small>{error}</small>{retry&&<button className="primary" onClick={retry}>Спробувати ще раз</button>}</>:<div className="boot-track" aria-hidden="true"><span/></div>}
    </div>
  </main>;
}
