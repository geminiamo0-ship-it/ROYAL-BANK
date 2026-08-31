const fs = require('fs');
let code = fs.readFileSync('src/actions/exam.ts', 'utf8');
code = code.replace(/export async function getFullExamSession[\s\S]*?rawAnswers: data.user_answers \|\| \[\]\r?\n  \};\r?\n\}/, '');
fs.writeFileSync('src/actions/exam.ts', code);
