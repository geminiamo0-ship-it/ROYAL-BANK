'use client';

import React from 'react';

type RangeRow = readonly [label: string, value: string];

type RangeSection = {
  title: string;
  rows: readonly RangeRow[];
  note?: string;
};

const REFERENCE_SECTIONS: readonly RangeSection[] = [
  {
    title: 'Haematology',
    rows: [
      ['Haemoglobin', 'Men: 135–180 g/L · Women: 115–160 g/L'],
      ['Mean cell volume', '82–100 fL'],
      ['Platelets', '150–400 × 10⁹/L'],
      ['White blood cells', '4.0–11.0 × 10⁹/L'],
      ['Neutrophils', '2.0–7.0 × 10⁹/L'],
      ['Lymphocytes', '1.0–3.5 × 10⁹/L'],
      ['Eosinophils', '0.1–0.4 × 10⁹/L'],
    ],
  },
  {
    title: 'Urea and electrolytes',
    rows: [
      ['Sodium', '135–145 mmol/L'],
      ['Potassium', '3.5–5.0 mmol/L'],
      ['Urea', '2.0–7 mmol/L'],
      ['Creatinine', '55–120 µmol/L'],
      ['Bicarbonate', '22–28 mmol/L'],
      ['Chloride', '95–105 mmol/L'],
    ],
  },
  {
    title: 'Liver function tests',
    rows: [
      ['Bilirubin', '3–17 µmol/L'],
      ['Alanine transferase (ALT)', '3–40 IU/L'],
      ['Aspartate transaminase (AST)', '3–30 IU/L'],
      ['Alkaline phosphatase (ALP)', '30–100 µmol/L'],
      ['Gamma glutamyl transferase (γGT)', '8–60 U/L'],
      ['Total protein', '60–80 g/L'],
    ],
  },
  {
    title: 'Other haematology',
    rows: [
      ['Erythrocyte sedimentation rate (ESR)', 'Men: < (age / 2) mm/hr · Women: < ((age + 10) / 2) mm/hr'],
      ['Prothrombin time (PT)', '10–14 secs'],
      ['Activated partial thromboplastin time (APTT)', '25–35 secs'],
      ['Ferritin', '20–230 ng/mL'],
      ['Vitamin B12', '200–900 ng/L'],
      ['Folate', '3.0 nmol/L'],
      ['Reticulocytes', '0.5–1.5%'],
      ['D-Dimer', '< 400 ng/mL'],
    ],
  },
  {
    title: 'Other biochemistry',
    rows: [
      ['Calcium', '2.1–2.6 mmol/L'],
      ['Phosphate', '0.8–1.4 mmol/L'],
      ['CRP', '< 10 mg/L'],
      ['Thyroid stimulating hormone (TSH)', '0.5–5.5 mU/L'],
      ['Free thyroxine (T4)', '9–18 pmol/L'],
      ['Total thyroxine (T4)', '70–140 nmol/L'],
      ['Amylase', '70–300 U/L'],
      ['Uric acid', '0.18–0.48 mmol/L'],
      ['Creatine kinase', '35–250 U/L'],
    ],
  },
  {
    title: 'Arterial blood gases',
    rows: [
      ['pH', '7.35–7.45'],
      ['pCO₂', '4.5–6.0 kPa'],
      ['pO₂', '10–14 kPa'],
      ['Bicarbonate', '22–28 mmol/L'],
      ['Base excess', '−2 to +2 mmol/L'],
    ],
  },
  {
    title: 'Lipids',
    note: 'Desirable lipid values depend on other risk factors for cardiovascular disease; these values are a guide.',
    rows: [
      ['Total cholesterol', '< 5 mmol/L'],
      ['Triglycerides', '< 2 mmol/L'],
      ['HDL cholesterol', '> 1 mmol/L'],
      ['LDL cholesterol', '< 3 mmol/L'],
    ],
  },
];

export function ExamReferenceRanges() {
  return (
    <div className="w-[min(680px,calc(100vw-32px))] text-[12px] text-[#e8ebed]">
      <div className="mb-3 text-[15px] font-semibold text-white">Reference ranges</div>
      <div className="max-h-[min(68dvh,650px)] space-y-5 overflow-y-auto overscroll-contain pr-2">
        {REFERENCE_SECTIONS.map((section) => (
          <section key={section.title}>
            <h3 className="mb-2 text-[13px] font-semibold text-[#fff0a3]">{section.title}</h3>
            {section.note ? <p className="mb-2 leading-5 text-[#bfc5ca]">{section.note}</p> : null}
            <div className="overflow-hidden rounded border border-[#50575d]">
              <table className="w-full border-collapse">
                <tbody>
                  {section.rows.map(([label, value]) => (
                    <tr key={label} className="border-b border-[#4a5157] last:border-b-0">
                      <th className="w-[44%] bg-[#353b40] px-3 py-2 text-left align-top font-semibold text-white">
                        {label}
                      </th>
                      <td className="bg-[#2b3034] px-3 py-2 align-top text-[#d6dade]">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        <p className="pb-1 text-[11px] leading-5 text-[#aeb5ba]">
          Reference ranges vary according to individual labs. All values are for adults unless otherwise stated.
        </p>
      </div>
    </div>
  );
}
