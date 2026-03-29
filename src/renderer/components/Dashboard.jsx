import React, { useState, useEffect, useRef, useCallback } from "react";

// ── Design tokens ─────────────────────────────────────────────
const T = {
  surface:"#121416", surfaceLow:"#1a1c1e", surfaceContainer:"#1e2022",
  surfaceHigh:"#282a2c", surfaceBright:"#38393c", surfaceLowest:"#0c0e10",
  primary:"#a9c7ff", primaryContainer:"#004b95",
  tertiary:"#ffba38", tertiaryContainer:"#674600", onTertiary:"#432c00",
  onSurface:"#e2e2e5", onSurfaceVariant:"#c3c6d4",
  outline:"#8d909d", outlineVariant:"#434652",
  error:"#ffb4ab", errorContainer:"#93000a",
  green:"#4fc98a",
};

const SC = {
  passed:  { fg:"#4fc98a", bg:"rgba(79,201,138,0.1)" },
  failed:  { fg:T.error,   bg:"rgba(255,180,171,0.1)" },
  running: { fg:T.tertiary,bg:"rgba(255,186,56,0.1)"  },
  pending: { fg:T.outline, bg:"transparent" },
};

// ── CSV parser ────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  const rows = lines.slice(1).map(line => {
    const vals = line.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
    return obj;
  }).filter(row => Object.values(row).some(v => v));
  return { headers, rows };
}

// ── Gherkin/Playwright detector ───────────────────────────────
function detectAndParseSteps(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  // Gherkin: lines start with Given/When/Then/And/But
  const gherkinKeywords = /^(given|when|then|and|but|scenario|feature|background)\s/i;
  const isGherkin = lines.some(l => gherkinKeywords.test(l.trim()));

  if (isGherkin) {
    return lines
      .filter(l => /^(given|when|then|and|but)\s/i.test(l.trim()))
      .map((l, i) => ({ index: i + 1, action: l.trim(), type: "gherkin" }));
  }
  // Playwright / numbered steps
  return lines
    .filter(l => l.trim())
    .map((l, i) => ({
      index: i + 1,
      action: l.replace(/^\d+[\.\)]\s*/, "").trim(),
      type: "step",
    }));
}

// ── Components ────────────────────────────────────────────────
function Dot({ s }) {
  const c = SC[s] || SC.pending;
  return (
    <span style={{
      width:8, height:8, borderRadius:"50%", background:c.fg,
      display:"inline-block", flexShrink:0,
      boxShadow: s==="running" ? `0 0 8px ${c.fg}` : "none",
      animation: s==="running" ? "pulseDot 1s ease-in-out infinite" : "none",
    }}/>
  );
}

function StepCard({ step, index, status, message, onCreateTicket }) {
  const c = SC[status] || SC.pending;
  return (
    <div style={{
      background: status==="running" ? T.surfaceHigh : T.surfaceContainer,
      borderRadius:8, padding:"10px 14px", position:"relative",
      overflow:"hidden", transition:"background .2s",
    }}>
      {(status==="running"||status==="failed") && (
        <div style={{
          position:"absolute", left:0, top:0, bottom:0, width:4,
          background: status==="failed" ? T.error : T.tertiary,
          borderRadius:"4px 0 0 4px",
        }}/>
      )}
      <div style={{ display:"flex", alignItems:"flex-start", gap:10, paddingLeft:8 }}>
        <div style={{
          width:22, height:22, borderRadius:"50%", background:c.bg,
          border:`1px solid ${c.fg}30`, display:"flex", alignItems:"center",
          justifyContent:"center", fontSize:10, fontWeight:700,
          color:c.fg, flexShrink:0,
        }}>{index + 1}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{
            fontSize:11, fontWeight:500, color:T.onSurface,
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
          }}>{step.action}</div>
          {step.type === "gherkin" && (
            <div style={{ fontSize:9, color:T.primary, marginTop:1, fontFamily:"monospace" }}>GHERKIN</div>
          )}
          {message && (
            <div style={{ fontSize:11, color:status==="failed"?T.error:T.onSurfaceVariant, marginTop:2, lineHeight:1.5 }}>
              {message}
            </div>
          )}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
          <Dot s={status}/>
          <span style={{ fontSize:10, color:c.fg, fontWeight:600, textTransform:"uppercase", letterSpacing:.4 }}>
            {status}
          </span>
          {status==="failed" && (
            <button onClick={() => onCreateTicket(step, message)} style={{
              padding:"2px 8px", background:T.tertiaryContainer, color:T.tertiary,
              border:"none", borderRadius:4, fontSize:10, fontWeight:600,
              cursor:"pointer", fontFamily:"Inter,sans-serif",
            }}>🎫 Jira</button>
          )}
        </div>
      </div>
    </div>
  );
}

function LogEntry({ entry }) {
  const cols = { ai:T.primary, error:T.error, warn:T.tertiary, info:T.onSurfaceVariant, debug:T.outlineVariant };
  const pfx  = { ai:"✦", error:"✗", warn:"⚠", info:"›", debug:"·" };
  const c = cols[entry.level] || T.onSurfaceVariant;
  return (
    <div style={{
      padding:"2px 0", fontSize:11, fontFamily:"monospace", color:c,
      lineHeight:1.6, background:entry.level==="ai"?"rgba(169,199,255,0.03)":"transparent",
    }}>
      <span style={{ color:T.outlineVariant, marginRight:8 }}>
        {new Date(entry.timestamp).toLocaleTimeString()}
      </span>
      <span style={{ marginRight:6 }}>{pfx[entry.level]||"›"}</span>
      {entry.message}
    </div>
  );
}

// ── Agent Chat Box ────────────────────────────────────────────
function AgentChatBox({ question, onAnswer, active }) {
  const [input, setInput] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (active && inputRef.current) {
      inputRef.current.focus();
      setInput("");
    }
  }, [active, question]);

  function send() {
    if (!input.trim()) return;
    onAnswer(input.trim());
    setInput("");
  }

  return (
    <div style={{
      borderTop: `1px solid ${T.surfaceHigh}`,
      padding:"10px 14px",
      background: active ? "rgba(169,199,255,0.04)" : T.surfaceLow,
      transition:"background .3s",
      flexShrink:0,
    }}>
      {/* Agent question bubble */}
      <div style={{
        minHeight:36,
        marginBottom:8,
        padding:"8px 12px",
        background: active ? T.surfaceHigh : T.surfaceContainer,
        borderRadius:8,
        borderLeft:`3px solid ${active ? T.primary : T.outlineVariant}`,
        fontSize:12,
        color: active ? T.onSurface : T.onSurfaceVariant,
        lineHeight:1.5,
        transition:"all .3s",
      }}>
        {active && question ? (
          <>
            <div style={{ fontSize:10, color:T.primary, fontWeight:700, marginBottom:4, textTransform:"uppercase", letterSpacing:.4 }}>
              ✦ Agent needs input
            </div>
            {question}
          </>
        ) : (
          <span style={{ fontStyle:"italic", fontSize:11 }}>
            Agent chat activates when the AI needs clarification…
          </span>
        )}
      </div>

      {/* Input row */}
      <div style={{ display:"flex", gap:6 }}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key==="Enter" && send()}
          disabled={!active}
          placeholder={active ? "Type your answer and press Enter…" : "Waiting for agent…"}
          style={{
            flex:1, background:T.surfaceLowest,
            border:"none",
            borderBottom:`2px solid ${active ? T.primary : T.outlineVariant}`,
            borderRadius:"4px 4px 0 0",
            padding:"8px 10px", color:T.onSurface,
            fontSize:12, fontFamily:"Inter,sans-serif", outline:"none",
            opacity: active ? 1 : 0.5,
            cursor: active ? "text" : "not-allowed",
            transition:"border-color .2s",
          }}
        />
        <button
          onClick={send}
          disabled={!active || !input.trim()}
          style={{
            padding:"8px 14px",
            background: active && input.trim() ? T.primary : T.surfaceHigh,
            color: active && input.trim() ? T.primaryContainer : T.outlineVariant,
            border:"none", borderRadius:6,
            fontFamily:"Inter,sans-serif", fontWeight:700, fontSize:12,
            cursor: active && input.trim() ? "pointer" : "not-allowed",
            transition:"all .15s",
          }}
        >Send</button>
      </div>
    </div>
  );
}

// ── CSV Panel ─────────────────────────────────────────────────
function CSVPanel({ csvData, onLoad, onClear }) {
  const fileRef = useRef(null);

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const parsed = parseCSV(ev.target.result);
      onLoad(parsed, file.name);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function downloadTemplate() {
    const template = [
      "email,password,account,role,environment",
      "admin@yourco.com,Admin123!,Account_A,admin,staging",
      "customer@gmail.com,Pass456!,Account_A,customer,staging",
      "customer2@gmail.com,Pass789!,Account_B,customer,staging",
    ].join("\n");
    const blob = new Blob([template], { type:"text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "echo-q-bot-template.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{
      borderTop:`1px solid ${T.surfaceHigh}`,
      padding:"10px 14px 12px",
      flexShrink:0,
    }}>
      <div style={{
        display:"flex", alignItems:"center",
        justifyContent:"space-between", marginBottom:8,
      }}>
        <div style={{
          fontSize:10, fontWeight:700, color:T.onSurfaceVariant,
          textTransform:"uppercase", letterSpacing:.6,
        }}>
          Test Data (CSV)
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <button onClick={downloadTemplate} style={{
            background:"none", border:"none", color:T.primary,
            cursor:"pointer", fontSize:10, fontWeight:600,
            fontFamily:"Inter,sans-serif", padding:0,
          }}>↓ Template</button>
          {csvData && (
            <button onClick={onClear} style={{
              background:"none", border:"none", color:T.error,
              cursor:"pointer", fontSize:10, fontWeight:600,
              fontFamily:"Inter,sans-serif", padding:0,
            }}>✕ Clear</button>
          )}
        </div>
      </div>

      {csvData ? (
        <div>
          {/* Stats */}
          <div style={{
            display:"flex", gap:8, marginBottom:8,
            padding:"6px 10px", background:T.surfaceContainer,
            borderRadius:6, fontSize:11,
          }}>
            <span style={{ color:T.green, fontWeight:600 }}>
              ✓ {csvData.fileName}
            </span>
            <span style={{ color:T.onSurfaceVariant }}>
              {csvData.rows.length} row{csvData.rows.length!==1?"s":""} · {csvData.headers.length} columns
            </span>
          </div>
          {/* Column chips */}
          <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:6 }}>
            {csvData.headers.map(h => (
              <span key={h} style={{
                padding:"2px 8px", background:T.surfaceHigh,
                borderRadius:100, fontSize:10,
                color:T.primary, fontFamily:"monospace",
              }}>
                {`{{${h}}}`}
              </span>
            ))}
          </div>
          <div style={{ fontSize:10, color:T.outlineVariant, lineHeight:1.5 }}>
            Use <span style={{ fontFamily:"monospace", color:T.onSurfaceVariant }}>{"{{column_name}}"}</span> in your test steps. The agent will substitute values from row {csvData.activeRow + 1} of {csvData.rows.length}.
          </div>
          {/* Row selector */}
          {csvData.rows.length > 1 && (
            <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:8 }}>
              <span style={{ fontSize:10, color:T.onSurfaceVariant }}>Active row:</span>
              <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                {csvData.rows.map((row, i) => (
                  <button key={i} onClick={() => onLoad({...csvData, activeRow:i}, csvData.fileName)} style={{
                    padding:"2px 8px", borderRadius:4, border:"none",
                    background: csvData.activeRow===i ? T.tertiary : T.surfaceHigh,
                    color: csvData.activeRow===i ? T.onTertiary : T.onSurfaceVariant,
                    fontSize:10, fontWeight:600, cursor:"pointer",
                    fontFamily:"Inter,sans-serif",
                  }}>
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          style={{
            width:"100%", padding:"10px",
            background:"none",
            border:`1px dashed ${T.outlineVariant}`,
            borderRadius:6, color:T.onSurfaceVariant,
            fontSize:12, cursor:"pointer",
            fontFamily:"Inter,sans-serif",
            display:"flex", alignItems:"center",
            justifyContent:"center", gap:8,
            transition:"all .15s",
          }}
          onMouseEnter={e => { e.target.style.borderColor=T.primary; e.target.style.color=T.primary; }}
          onMouseLeave={e => { e.target.style.borderColor=T.outlineVariant; e.target.style.color=T.onSurfaceVariant; }}
        >
          📎 Upload test data CSV
        </button>
      )}
      <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display:"none" }}/>
    </div>
  );
}

// ── Gherkin / Manual step panel ───────────────────────────────
function ManualStepsPanel({ onLoad, active }) {
  const [text, setText] = useState("");
  const [detected, setDetected] = useState(null);

  function handleChange(val) {
    setText(val);
    if (val.trim()) {
      const steps = detectAndParseSteps(val);
      setDetected({ count: steps.length, type: /^(given|when|then|and|but)/i.test(val.trim()) ? "Gherkin" : "Steps" });
    } else {
      setDetected(null);
    }
  }

  function handleLoad() {
    if (!text.trim()) return;
    const steps = detectAndParseSteps(text);
    onLoad(steps);
  }

  return (
    <div style={{
      borderTop:`1px solid ${T.surfaceHigh}`,
      padding:"10px 14px",
      flexShrink:0,
    }}>
      <div style={{
        display:"flex", alignItems:"center",
        justifyContent:"space-between", marginBottom:6,
      }}>
        <div style={{
          fontSize:10, fontWeight:700, color:T.onSurfaceVariant,
          textTransform:"uppercase", letterSpacing:.6,
        }}>
          Manual Steps / Gherkin
        </div>
        {detected && (
          <span style={{
            fontSize:10, fontWeight:600,
            color: detected.type==="Gherkin" ? T.primary : T.tertiary,
            background: detected.type==="Gherkin" ? "rgba(169,199,255,0.1)" : "rgba(255,186,56,0.1)",
            padding:"2px 8px", borderRadius:100,
          }}>
            {detected.type} · {detected.count} step{detected.count!==1?"s":""}
          </span>
        )}
      </div>
      <textarea
        value={text}
        onChange={e => handleChange(e.target.value)}
        placeholder={
          "Paste Gherkin or numbered steps:\n\nGiven I am on the login page\nWhen I enter {{email}} and {{password}}\nThen I should see the dashboard\n\n— or —\n\n1. Navigate to the login page\n2. Enter {{email}} in the email field\n3. Click Sign In"
        }
        style={{
          width:"100%", background:T.surfaceLowest,
          border:"none",
          borderBottom:`2px solid ${text ? T.primary : T.outlineVariant}`,
          borderRadius:"4px 4px 0 0",
          padding:"8px 10px", color:T.onSurface,
          fontSize:11, fontFamily:"monospace", outline:"none",
          resize:"vertical", minHeight:90,
          lineHeight:1.6,
        }}
      />
      <button
        onClick={handleLoad}
        disabled={!text.trim() || active}
        style={{
          marginTop:6, width:"100%", padding:"7px",
          background: text.trim() && !active ? T.surfaceHigh : T.surfaceContainer,
          color: text.trim() && !active ? T.onSurface : T.outlineVariant,
          border:"none", borderRadius:6,
          fontFamily:"Inter,sans-serif", fontWeight:600,
          fontSize:12, cursor: text.trim() && !active ? "pointer" : "not-allowed",
        }}
      >
        {active ? "Stop current run first" : "↑ Load these steps"}
      </button>
    </div>
  );
}

// ── Jira Modal ────────────────────────────────────────────────
function JiraModal({ data, onClose }) {
  const [proj,setPrj]=useState("");
  const [prio,setPrio]=useState("High");
  const [title,setTitle]=useState(data?.title||"");
  const [creating,setCreating]=useState(false);
  const [result,setResult]=useState(null);

  async function create() {
    setCreating(true);
    try {
      const r = await window.echoQBot.jira.createTicket({
        projectKey:proj.toUpperCase(), summary:title,
        priority:prio, issueType:"Bug",
        labels:["echo-q-bot","automated-test"],
        stepContext:data?.stepText||"", actual:data?.actual||"",
      });
      setResult(r);
    } catch(e) { setResult({ok:false,error:e.message}); }
    finally { setCreating(false); }
  }

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:9999,
      background:"rgba(0,0,0,0.65)", backdropFilter:"blur(4px)",
      display:"flex", alignItems:"center", justifyContent:"center",
    }}>
      <div style={{
        background:T.surfaceBright, borderRadius:12,
        padding:"24px 28px", width:440,
        boxShadow:"0 24px 64px rgba(0,93,183,0.2)",
      }}>
        {result ? (
          <div style={{ textAlign:"center", padding:"16px 0" }}>
            {result.ok ? (
              <>
                <div style={{ fontSize:28, marginBottom:8 }}>✓</div>
                <div style={{ color:T.green, fontWeight:600, marginBottom:8 }}>{result.key} created</div>
                <button onClick={() => window.echoQBot.system.openExternal({url:result.url})}
                  style={{ color:T.primary, background:"none", border:"none", cursor:"pointer", fontSize:12 }}>
                  View in Jira →
                </button>
              </>
            ) : (
              <div style={{ color:T.error }}>{result.error}</div>
            )}
            <button onClick={onClose} style={{
              marginTop:14, padding:"7px 18px",
              background:T.surfaceHigh, color:T.onSurface,
              border:"none", borderRadius:6, cursor:"pointer",
              fontFamily:"Inter,sans-serif", display:"block", margin:"14px auto 0",
            }}>Close</button>
          </div>
        ) : (
          <>
            <div style={{ fontFamily:"Manrope,sans-serif", fontWeight:800, fontSize:16, color:T.onSurface, marginBottom:16 }}>
              🎫 Create Jira Ticket
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              {[
                {l:"Project Key",v:proj,s:setPrj,p:"QA"},
                {l:"Title",v:title,s:setTitle,p:"Bug title"},
              ].map(f => (
                <div key={f.l}>
                  <label style={{ fontSize:10, fontWeight:600, color:T.onSurfaceVariant, textTransform:"uppercase", letterSpacing:.4, display:"block", marginBottom:5 }}>{f.l}</label>
                  <input value={f.v} onChange={e=>f.s(e.target.value)} placeholder={f.p} style={{
                    width:"100%", background:T.surfaceLowest, border:"none",
                    borderBottom:`2px solid ${T.outlineVariant}`, borderRadius:"4px 4px 0 0",
                    padding:"8px 10px", color:T.onSurface, fontSize:12,
                    fontFamily:"Inter,sans-serif", outline:"none",
                  }}/>
                </div>
              ))}
              <div>
                <label style={{ fontSize:10, fontWeight:600, color:T.onSurfaceVariant, textTransform:"uppercase", letterSpacing:.4, display:"block", marginBottom:5 }}>Priority</label>
                <div style={{ display:"flex", gap:5 }}>
                  {["Highest","High","Medium","Low"].map(p => (
                    <button key={p} onClick={()=>setPrio(p)} style={{
                      padding:"4px 10px", borderRadius:4, border:"none",
                      background:prio===p?T.tertiary:T.surfaceHigh,
                      color:prio===p?T.onTertiary:T.onSurfaceVariant,
                      fontSize:11, fontWeight:600, cursor:"pointer",
                      fontFamily:"Inter,sans-serif",
                    }}>{p}</button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display:"flex", gap:8, marginTop:20 }}>
              <button onClick={onClose} style={{
                flex:1, padding:"9px", background:"transparent",
                color:T.onSurfaceVariant, border:`1px solid ${T.outlineVariant}`,
                borderRadius:6, cursor:"pointer", fontFamily:"Inter,sans-serif", fontSize:12,
              }}>Cancel</button>
              <button onClick={create} disabled={creating||!proj.trim()||!title.trim()} style={{
                flex:2, padding:"9px",
                background:proj&&title?T.tertiary:T.surfaceHigh,
                color:proj&&title?T.onTertiary:T.onSurfaceVariant,
                border:"none", borderRadius:6, cursor:"pointer",
                fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:600,
              }}>{creating?"Creating…":"Create Ticket"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}


// ── Spec File Panel ───────────────────────────────────────────
function SpecFilePanel({ specData, onLoad, onClear, active }) {
  const fileRef = useRef(null);

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const code = ev.target.result;
      // Quick parse to count test blocks
      const testCount = (code.match(/test\s*\(/g) || []).length;
      const stepCount = (code.match(/await\s+page\./g) || []).length + (code.match(/await\s+expect\s*\(/g) || []).length;
      onLoad({ code, fileName: file.name, testCount, stepCount });
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  return (
    <div style={{ borderTop:`1px solid ${T.surfaceHigh}`, padding:"10px 14px 12px", flexShrink:0 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
        <div style={{ fontSize:10, fontWeight:700, color:T.onSurfaceVariant, textTransform:"uppercase", letterSpacing:.6 }}>
          Playwright Spec File
        </div>
        {specData && (
          <button onClick={onClear} style={{ background:"none", border:"none", color:T.error, cursor:"pointer", fontSize:10, fontWeight:600, fontFamily:"Inter,sans-serif", padding:0 }}>
            ✕ Clear
          </button>
        )}
      </div>

      {specData ? (
        <div>
          <div style={{ display:"flex", gap:8, padding:"6px 10px", background:T.surfaceContainer, borderRadius:6, fontSize:11, marginBottom:6 }}>
            <span style={{ color:T.green, fontWeight:600 }}>✓ {specData.fileName}</span>
            <span style={{ color:T.onSurfaceVariant }}>{specData.testCount} test{specData.testCount!==1?"s":""} · {specData.stepCount} steps</span>
          </div>
          <div style={{ display:"flex", gap:6 }}>
            {[
              { icon:"🎭", label:"Playwright" },
              { icon:"⚡", label:"Direct exec" },
              { icon:"🤖", label:"AI recovery" },
            ].map(tag => (
              <span key={tag.label} style={{ fontSize:10, padding:"2px 7px", borderRadius:100, background:T.surfaceHigh, color:T.onSurfaceVariant }}>
                {tag.icon} {tag.label}
              </span>
            ))}
          </div>
          <div style={{ fontSize:10, color:T.outlineVariant, marginTop:6, lineHeight:1.5 }}>
            Steps run directly via Playwright. AI activates only when a step fails to recover automatically.
          </div>
        </div>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          disabled={active}
          style={{
            width:"100%", padding:"10px", background:"none",
            border:`1px dashed ${T.outlineVariant}`, borderRadius:6,
            color: active ? T.outlineVariant : T.onSurfaceVariant,
            fontSize:12, cursor: active ? "not-allowed" : "pointer",
            fontFamily:"Inter,sans-serif",
            display:"flex", alignItems:"center", justifyContent:"center", gap:8,
            opacity: active ? 0.5 : 1,
          }}
          onMouseEnter={e => { if(!active){ e.currentTarget.style.borderColor=T.primary; e.currentTarget.style.color=T.primary; }}}
          onMouseLeave={e => { e.currentTarget.style.borderColor=T.outlineVariant; e.currentTarget.style.color=T.onSurfaceVariant; }}
        >
          🎭 Upload .spec.js / .test.js
        </button>
      )}
      <input ref={fileRef} type="file" accept=".js,.ts,.spec.js,.test.js,.spec.ts,.test.ts" onChange={handleFile} style={{ display:"none" }}/>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Dashboard
// ═══════════════════════════════════════════════════════════════
export default function Dashboard({ onOpenSettings }) {
  const [issueKey,    setIssueKey]    = useState("");
  const [issue,       setIssue]       = useState(null);
  const [fetchErr,    setFetchErr]    = useState("");
  const [fetching,    setFetching]    = useState(false);
  const [stepStates,  setStepStates]  = useState({});
  const [logs,        setLogs]        = useState([]);
  const [running,     setRunning]     = useState(false);
  const [screenshot,  setScreenshot]  = useState(null);
  const [summary,     setSummary]     = useState(null);
  const [jiraModal,   setJiraModal]   = useState(null);
  const [credStatus,  setCredStatus]  = useState({});
  const [csvData,     setCsvData]     = useState(null);
  const [specData,    setSpecData]    = useState(null);
  const [manualSteps, setManualSteps] = useState(null);
  // Agent chat
  const [agentQuestion, setAgentQuestion] = useState(null);
  const [updateInfo,    setUpdateInfo]    = useState(null);
  const [agentActive,   setAgentActive]   = useState(false);
  const agentAnswerRef = useRef(null); // resolve function for pending agent question

  const logRef = useRef(null);

  // Credential status
  useEffect(() => {
    window.echoQBot?.credentials.status().then(r => { if (r.ok) setCredStatus(r.status); });
  }, []);

  // Automation event listeners
  useEffect(() => {
    const unsubs = [
      window.echoQBot.on("automation:step-update", d => {
        setStepStates(p => ({ ...p, [d.stepIndex]: { status:d.status, message:d.message } }));
        if (d.screenshot) setScreenshot(d.screenshot);
      }),
      window.echoQBot.on("automation:log", d => {
        setLogs(p => [...p.slice(-199), d]);
      }),
      window.echoQBot.on("automation:screenshot", d => {
        setScreenshot(d.dataUrl);
      }),
      window.echoQBot.on("automation:complete", d => {
        setSummary(d); setRunning(false);
        setAgentActive(false); setAgentQuestion(null);
      }),
      window.echoQBot.on("automation:error", d => {
        setLogs(p => [...p, { level:"error", message:d.message, timestamp:new Date().toISOString() }]);
        setRunning(false); setAgentActive(false); setAgentQuestion(null);
      }),
      window.echoQBot.on("automation:failure-detected", d => {
        setJiraModal({
          title:`[${issue?.key||""}] Step ${d.stepIndex+1}: ${(d.stepText||"").slice(0,60)}`,
          stepText:d.stepText, actual:d.actual,
        });
      }),
      // Agent asks a question when stuck
      window.echoQBot.on("automation:agent-question", d => {
        setAgentQuestion(d.question);
        setAgentActive(true);
        setLogs(p => [...p, { level:"ai", message:`[Agent] ${d.question}`, timestamp:new Date().toISOString() }]);
      }),
    ];
    return () => unsubs.forEach(f => f?.());
  }, [issue]);

  // Auto-scroll logs
  useEffect(() => { logRef.current?.scrollIntoView({ behavior:"smooth" }); }, [logs]);

  // Fetch Jira issue
  async function fetchIssue() {
    if (!issueKey.trim()) return;
    setFetching(true); setFetchErr(""); setIssue(null);
    setStepStates({}); setLogs([]); setSummary(null); setManualSteps(null);
    try {
      const r = await window.echoQBot.jira.fetchTests(issueKey.trim().toUpperCase());
      if (r.ok) setIssue(r.issue);
      else setFetchErr(r.error || "Failed to fetch issue");
    } catch(e) { setFetchErr(e.message); }
    finally { setFetching(false); }
  }

  // Load manual steps
  function loadManualSteps(steps) {
    setManualSteps(steps);
    setIssue(null); setStepStates({}); setLogs([]); setSummary(null);
    setFetchErr("");
  }

  // Active steps (Jira OR manual)
  const activeSteps = issue?.steps || manualSteps || [];
  const hasSteps = activeSteps.length > 0;
  const canRun   = hasSteps || !!specData;

  // Resolve CSV variables in step text
  function resolveStep(step) {
    if (!csvData || !csvData.rows.length) return step;
    const row = csvData.rows[csvData.activeRow ?? 0];
    const resolved = step.action.replace(/\{\{(\w+)\}\}/g, (_, key) => row[key] ?? `{{${key}}}`);
    return { ...step, action: resolved, originalAction: step.action };
  }

  // Start run
  async function startRun() {
    const isSpecMode = !!specData && !hasSteps;
    if (!hasSteps && !isSpecMode) return;

    setRunning(true); setSummary(null); setStepStates({});
    setLogs([]); setScreenshot(null);
    setAgentActive(false); setAgentQuestion(null);

    const provider = credStatus["ai-provider"] || "openai";
    const model    = credStatus["ai-model"]    || "gpt-4o";
    const csvContext = csvData
      ? { available: csvData.headers, values: csvData.rows[csvData.activeRow ?? 0] }
      : null;

    if (isSpecMode) {
      // Playwright spec file mode
      await window.echoQBot.automation.start({
        issueKey:  "SPEC",
        steps:     [],
        provider,  model,
        specMode:  true,
        specCode:  specData.code,
        csvContext,
      });
    } else {
      // Standard step mode (Gherkin / manual / Xray)
      const steps = activeSteps.map(resolveStep);
      await window.echoQBot.automation.start({
        issueKey: issue?.key || "MANUAL",
        steps, provider, model, csvContext,
      });
    }
  }

  async function stopRun() {
    await window.echoQBot.automation.stop();
    setRunning(false); setAgentActive(false); setAgentQuestion(null);
  }

  // Agent answer handler
  function handleAgentAnswer(answer) {
    setAgentActive(false);
    setAgentQuestion(null);
    setLogs(p => [...p, { level:"info", message:`[You] ${answer}`, timestamp:new Date().toISOString() }]);
    // Send answer back to automation engine via IPC
    window.echoQBot.automation.sendAnswer?.({ answer });
  }

  const aiOk   = credStatus["openai-api-key"] || credStatus["anthropic-api-key"] || credStatus["gemini-api-key"];
  const jiraOk = credStatus["jira-api-token"];

  return (
    <div style={{
      display:"flex", height:"100vh",
      background:T.surface, fontFamily:"Inter,sans-serif",
      color:T.onSurface, overflow:"hidden",
    }}>
      <style>{`
        @keyframes pulseDot { 0%,100%{opacity:1}50%{opacity:.4} }
        input::placeholder,textarea::placeholder { color:${T.outlineVariant}; }
        textarea { caret-color:${T.tertiary}; }
        input { caret-color:${T.tertiary}; }
      `}</style>

      {/* ── LEFT PANE ── */}
      <aside style={{
        width:320, background:T.surfaceLow,
        display:"flex", flexDirection:"column",
        flexShrink:0, overflow:"hidden",
      }}>

        {/* Header */}
        <div style={{ padding:"16px 16px 12px", borderBottom:`1px solid ${T.surfaceHigh}`, flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
            <div>
              <div style={{ fontFamily:"Manrope,sans-serif", fontWeight:800, fontSize:16, letterSpacing:"-0.02em" }}>
                Echo Q Bot
              </div>
              <div style={{ fontSize:10, color:T.onSurfaceVariant, marginTop:2 }}>AI-Powered QA Automation</div>
            </div>
            <button onClick={onOpenSettings} style={{
              width:30, height:30, borderRadius:6, background:T.surfaceHigh,
              border:"none", color:T.onSurfaceVariant, cursor:"pointer", fontSize:14,
            }}>⚙</button>
          </div>
          <div style={{ display:"flex", gap:5 }}>
            {[{l:"AI",ok:!!aiOk},{l:"Jira",ok:!!jiraOk}].map(s => (
              <span key={s.l} style={{
                fontSize:10, fontWeight:600, padding:"2px 8px", borderRadius:100,
                background:s.ok?"rgba(79,201,138,0.1)":"rgba(255,180,171,0.08)",
                color:s.ok?T.green:T.error,
              }}>{s.ok?"✓":"!"} {s.l}</span>
            ))}
            {csvData && (
              <span style={{ fontSize:10, fontWeight:600, padding:"2px 8px", borderRadius:100, background:"rgba(169,199,255,0.1)", color:T.primary }}>
                📎 CSV
              </span>
            )}
            {manualSteps && (
              <span style={{ fontSize:10, fontWeight:600, padding:"2px 8px", borderRadius:100, background:"rgba(255,186,56,0.1)", color:T.tertiary }}>
                ✏ Manual
              </span>
            )}
            {specData && (
              <span style={{ fontSize:10, fontWeight:600, padding:"2px 8px", borderRadius:100, background:"rgba(79,201,138,0.1)", color:T.green }}>
                🎭 Spec
              </span>
            )}
          </div>
        </div>

        {/* Jira issue fetch */}
        <div style={{ padding:"12px 16px", borderBottom:`1px solid ${T.surfaceHigh}`, flexShrink:0 }}>
          <label style={{ fontSize:10, fontWeight:700, color:T.onSurfaceVariant, textTransform:"uppercase", letterSpacing:.6, display:"block", marginBottom:6 }}>
            Xray Test Issue
          </label>
          <div style={{ display:"flex", gap:7 }}>
            <input
              value={issueKey}
              onChange={e => setIssueKey(e.target.value)}
              onKeyDown={e => e.key==="Enter" && fetchIssue()}
              placeholder="e.g. QA-123"
              style={{
                flex:1, background:T.surfaceLowest, border:"none",
                borderBottom:`2px solid ${T.outlineVariant}`, borderRadius:"4px 4px 0 0",
                padding:"7px 9px", color:T.onSurface,
                fontSize:12, fontFamily:"Inter,sans-serif", outline:"none",
              }}
            />
            <button onClick={fetchIssue} disabled={fetching||!issueKey.trim()} style={{
              padding:"7px 12px", background:T.tertiary, color:T.onTertiary,
              border:"none", borderRadius:6, cursor:"pointer",
              fontFamily:"Inter,sans-serif", fontWeight:600, fontSize:12,
              opacity:issueKey.trim()?1:0.5,
            }}>{fetching?"…":"Load"}</button>
          </div>
          {fetchErr && <div style={{ marginTop:6, fontSize:11, color:T.error }}>{fetchErr}</div>}
        </div>

        {/* Steps list */}
        <div style={{ flex:1, overflowY:"auto", padding:"10px 12px" }}>
          {!hasSteps && (
            <div style={{ textAlign:"center", padding:"24px 16px", color:T.outlineVariant, fontSize:12, lineHeight:1.6 }}>
              Load a Jira issue above or paste steps below
            </div>
          )}
          {hasSteps && (
            <>
              {issue && (
                <div style={{ marginBottom:10 }}>
                  <div style={{ fontFamily:"Manrope,sans-serif", fontWeight:700, fontSize:13, color:T.onSurface }}>{issue.key}</div>
                  <div style={{ fontSize:11, color:T.onSurfaceVariant, marginTop:2 }}>{issue.summary}</div>
                  <div style={{ fontSize:10, color:T.outline, marginTop:3 }}>
                    {activeSteps.length} steps · {issue.status}
                    {csvData ? ` · CSV row ${(csvData.activeRow??0)+1}/${csvData.rows.length}` : ""}
                  </div>
                </div>
              )}
              {manualSteps && (
                <div style={{ marginBottom:10 }}>
                  <div style={{ fontFamily:"Manrope,sans-serif", fontWeight:700, fontSize:13, color:T.tertiary }}>Manual Steps</div>
                  <div style={{ fontSize:11, color:T.onSurfaceVariant, marginTop:2 }}>
                    {activeSteps.length} steps detected
                    {csvData ? ` · CSV row ${(csvData.activeRow??0)+1}/${csvData.rows.length}` : ""}
                  </div>
                </div>
              )}
              <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                {activeSteps.map((step, i) => {
                  const s = stepStates[i] || { status:"pending" };
                  const resolved = resolveStep(step);
                  return (
                    <StepCard key={i} step={resolved} index={i}
                      status={s.status} message={s.message}
                      onCreateTicket={(st, msg) => setJiraModal({
                        title:`Step ${i+1}: ${st.action?.slice(0,60)}`,
                        stepText:st.action, actual:msg,
                      })}
                    />
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Run controls */}
        {canRun && (
          <div style={{ padding:"10px 14px", borderTop:`1px solid ${T.surfaceHigh}`, flexShrink:0 }}>
            {summary && (
              <div style={{ display:"flex", gap:10, marginBottom:10, padding:"8px 10px", background:T.surfaceContainer, borderRadius:6 }}>
                {[{l:"Total",v:summary.total,c:T.onSurface},{l:"Passed",v:summary.passed,c:T.green},{l:"Failed",v:summary.failed,c:T.error}].map(s => (
                  <div key={s.l} style={{ flex:1, textAlign:"center" }}>
                    <div style={{ fontFamily:"Manrope,sans-serif", fontWeight:800, fontSize:18, color:s.c }}>{s.v}</div>
                    <div style={{ fontSize:9, color:T.onSurfaceVariant, textTransform:"uppercase", letterSpacing:.5 }}>{s.l}</div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={running?stopRun:startRun} disabled={!aiOk} style={{
              width:"100%", padding:"10px",
              background:running?T.errorContainer:T.tertiary,
              color:running?T.error:T.onTertiary,
              border:"none", borderRadius:6,
              fontFamily:"Inter,sans-serif", fontWeight:700, fontSize:13,
              cursor:aiOk?"pointer":"not-allowed", opacity:aiOk?1:0.5,
            }}>
              {running ? "⏹ Stop Run" : specData && !hasSteps ? "🎭 Run Spec File" : "▶ Start Automation"}
            </button>
            {!aiOk && (
              <div style={{ marginTop:5, fontSize:10, color:T.error, textAlign:"center" }}>
                Configure AI in ⚙ Settings first
              </div>
            )}
          </div>
        )}

        {/* Manual steps input */}
        <ManualStepsPanel onLoad={loadManualSteps} active={running}/>

        {/* Spec file panel */}
        <SpecFilePanel
          specData={specData}
          onLoad={(data) => { setSpecData(data); setManualSteps(null); setIssue(null); }}
          onClear={() => setSpecData(null)}
          active={running}
        />

        {/* CSV panel */}
        <CSVPanel
          csvData={csvData}
          onLoad={(parsed, name) => setCsvData({ ...parsed, fileName:name, activeRow:0 })}
          onClear={() => setCsvData(null)}
        />

      </aside>

      {/* ── CENTER PANE — Live Browser ── */}
      <main style={{ flex:1, display:"flex", flexDirection:"column", background:T.surface, overflow:"hidden" }}>
        {/* Update banner */}
        {updateInfo && (
          <div style={{
            padding:"8px 18px", background:"rgba(255,186,56,0.08)",
            borderBottom:`1px solid ${T.tertiaryContainer}`,
            display:"flex", alignItems:"center", gap:10, flexShrink:0,
          }}>
            <span style={{fontSize:14}}>🎉</span>
            <div style={{flex:1, fontSize:12, color:T.tertiary, fontWeight:600}}>
              Echo Q Bot {updateInfo.newVersion} is available
              <span style={{fontWeight:400, color:T.onSurfaceVariant, marginLeft:8}}>
                {(updateInfo.releaseNotes||"").slice(0,80)}{(updateInfo.releaseNotes||"").length>80?"…":""}
              </span>
            </div>
            <button onClick={()=>window.echoQBot.system.openExternal({url:updateInfo.downloadUrl})} style={{
              padding:"4px 14px", background:T.tertiary, color:T.onTertiary,
              border:"none", borderRadius:6, fontFamily:"Inter,sans-serif",
              fontWeight:700, fontSize:11, cursor:"pointer", flexShrink:0,
            }}>Download →</button>
            <button onClick={()=>setUpdateInfo(null)} style={{
              background:"none", border:"none", color:T.onSurfaceVariant,
              cursor:"pointer", fontSize:16, padding:"0 4px", lineHeight:1,
            }}>×</button>
          </div>
        )}

        <div style={{ padding:"12px 18px", borderBottom:`1px solid ${T.surfaceHigh}`, display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
          <div style={{ fontFamily:"Manrope,sans-serif", fontWeight:700, fontSize:13, color:T.onSurface }}>Live Browser</div>
          {running && (
            <span style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:T.tertiary, fontWeight:600 }}>
              <Dot s="running"/> Running
            </span>
          )}
          {agentActive && (
            <span style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:T.primary, fontWeight:600 }}>
              ✦ Agent waiting for your input ↓
            </span>
          )}
        </div>
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden", background:T.surfaceLowest }}>
          {screenshot ? (
            <img src={screenshot} alt="Browser view" style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain", display:"block" }}/>
          ) : (
            <div style={{ textAlign:"center", color:T.outlineVariant }}>
              <div style={{ fontSize:42, marginBottom:10, opacity:.3 }}>◎</div>
              <div style={{ fontSize:12 }}>Browser view appears here during automation</div>
            </div>
          )}
        </div>
      </main>

      {/* ── RIGHT PANE — AI Log + Chat ── */}
      <aside style={{ width:340, background:T.surfaceLow, display:"flex", flexDirection:"column", flexShrink:0 }}>
        <div style={{ padding:"12px 14px", borderBottom:`1px solid ${T.surfaceHigh}`, display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
          <div style={{ fontFamily:"Manrope,sans-serif", fontWeight:700, fontSize:13 }}>AI Reasoning Log</div>
          <button onClick={()=>setLogs([])} style={{ background:"none", border:"none", color:T.outlineVariant, cursor:"pointer", fontSize:10, padding:"2px 6px" }}>Clear</button>
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:"8px 12px" }}>
          {logs.length===0 && (
            <div style={{ color:T.outlineVariant, fontSize:11, textAlign:"center", paddingTop:36 }}>
              AI reasoning appears here during a run
            </div>
          )}
          {logs.map((e,i) => <LogEntry key={i} entry={e}/>)}
          <div ref={logRef}/>
        </div>

        {/* Agent chat box */}
        <AgentChatBox
          question={agentQuestion}
          active={agentActive}
          onAnswer={handleAgentAnswer}
        />
      </aside>

      {jiraModal && <JiraModal data={jiraModal} onClose={()=>setJiraModal(null)}/>}
    </div>
  );
}
