require('ts-node').register({
  compilerOptions: {
    module: 'commonjs',
    esModuleInterop: true,
    target: 'es2022'
  }
});
const { getLiveQuestionBankOutline } = require('./src/lib/question-bank.ts');
getLiveQuestionBankOutline(1).then(r => console.log(JSON.stringify(r.find(c => c.id === 'Cardiology'), null, 2)));
