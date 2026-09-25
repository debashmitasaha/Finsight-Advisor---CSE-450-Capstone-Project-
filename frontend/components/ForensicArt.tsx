import React from 'react';

/* ---------------------------------------------------------------------------
   One drawn diagram, kept because it carries the whole idea in three boxes and
   reads well at the top of the guide panel. The earlier fusion, threshold and
   split drawings were removed: the illustrated boards in the tabs say the same
   things far better, and two competing visual languages on one page looked worse
   than either alone.
   ------------------------------------------------------------------------- */

/** The loop: the engine scores, people judge, the line moves. */
export const LoopDiagram = ({ className = '' }: { className?: string }) => {
  const steps = [
    { label: 'Engine scores', color: '#5b5bd6' },
    { label: 'You judge', color: '#1baf7a' },
    { label: 'Line moves', color: '#eb6834' },
  ];
  return (
    <svg viewBox="0 0 560 108" className={`w-full ${className}`} role="img" aria-label="The engine scores, reviewers judge, and the alert line moves">
      {steps.map((step, index) => {
        const x = 24 + index * 178;
        return (
          <g key={step.label}>
            <rect x={x} y="26" width="148" height="46" rx="12" fill="#fff" stroke="#e4e4e7" />
            <circle cx={x + 24} cy="49" r="9" fill={step.color} fillOpacity="0.14" />
            <text x={x + 24} y="53" textAnchor="middle" fontSize="10" fontWeight="600" fill={step.color}>
              {index + 1}
            </text>
            <text x={x + 42} y="53" fontSize="11.5" fontWeight="500" fill="#3f3f46">{step.label}</text>
            {index < steps.length - 1 && (
              <>
                <path d={`M${x + 148} 49 L${x + 170} 49`} stroke="#d4d4d8" strokeWidth="1.5" />
                <path d={`M${x + 165} 45 L${x + 172} 49 L${x + 165} 53 Z`} fill="#d4d4d8" />
              </>
            )}
          </g>
        );
      })}
      <path d="M92 78 C 92 96, 468 96, 468 78" fill="none" stroke="#d4d4d8" strokeWidth="1.5" strokeDasharray="4 3" />
      <path d="M96 82 L92 75 L88 82 Z" fill="#d4d4d8" />
      <text x="280" y="104" textAnchor="middle" fontSize="10" fill="#a1a1aa">and the next run uses the new line</text>
    </svg>
  );
};
