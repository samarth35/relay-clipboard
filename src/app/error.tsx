"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="not-found"><h1>Let’s try that again.</h1><button className="button button-primary" onClick={reset}>Reload room</button></main>; }
