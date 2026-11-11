"""Removes personal starter content from the planner page before it goes into this public repo.
Run: python3 src/scrub.py src/planner.html  (build.sh runs it automatically)."""
import re, sys
p = sys.argv[1]; s = open(p, encoding="utf8").read()
R = [
 ('content:"Morning affirmations (I choose happiness. I trust, surrender and am walking in ease and grace with purpose and standing in my integrity.), toilet, retainer cleaning, doing the bed"', 'content:"Morning affirmations, get ready, make the bed"'),
 ('"Extended Yoga Nidra (45 min) with Allie"', '"Extended Yoga Nidra (45 min)"'),
 ('"Check & answer private WhatsApp","Circl.es communications (Triage Desk)"', '"Check & answer messages","Work communications"'),
 ('e.g. Work on retreat 1.41', 'e.g. Prepare the workshop'),
 ("e.g. Carolyn's feedback", "e.g. Feedback from a colleague"),
 ('for example "Carolyn" or "pack list"', 'for example "feedback" or "pack list"'),
 ('|jami|', '|'),
 ('|annika|', '|'),
 ('⭕️ Circl.es work', '⭕️ forum work'),
 ('for a Circl.es retreat', 'for a forum retreat'),
]
for a, b in R:
    if a in s: s = s.replace(a, b)
# old one-off migration that added a personal project: keep the flag, drop the content
s = re.sub(r'if \(!B\.mig\.includes\("death1"\)\) \{ B\.mig\.push\("death1"\);\n.*?rkey:k\}\)\)\); \} \}', 'if (!B.mig.includes("death1")) { B.mig.push("death1"); }', s, count=1, flags=re.S)
# starter backlog: neutral examples
s = re.sub(r'function blSeed\(\)\{\n.*?\n  return \{items,', '''function blSeed(){
  const items = []; const add = (title, col, parent, o) => { const it = blItem(title, col, parent, o); items.push(it); return it.id; };
  const w = add("Plan a weekend workshop", "tackling", null, {tags:["Workshop"], rkey:"workshop"});
  add("Draft the agenda", "backlog", w, {tags:["Workshop"], rkey:"agenda"});
  add("Get feedback on the agenda and update it", "waiting", w, {tags:["Workshop"], waitFor:"Feedback on the agenda", rkey:"feedback"});
  add("Write the pack list", "backlog", w, {tags:["Workshop","Travel"], rkey:"pack list"});
  const y = add("Record a guided meditation", "backlog", null, {tags:["Meditation"], rkey:"meditation"});
  add("Finish writing the script", "backlog", y, {tags:["Meditation"], rkey:"script"});
  add("Find background music", "ideas", y, {tags:["Meditation"], rkey:"music"});
  return {items,''', s, count=1, flags=re.S)
s = re.sub(r"e\.g\. 'For the Mauritius retreat:[^']*'", "e.g. 'For the workshop: book the room by Friday and ask about the music'", s)
open(p, "w", encoding="utf8").write(s)
bad = re.findall(r'(?i)annika|carolyn|penny|mauritius|jami|circl\.es|allie|whatsapp|triage desk|death meditation|precilla|shanti|1\.41|I choose happiness', s)
print("remaining:", sorted(set(bad)))
