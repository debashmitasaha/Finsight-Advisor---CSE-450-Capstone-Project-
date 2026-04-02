
import React from 'react';

interface LogoProps {
  className?: string;
  size?: number;
  variant?: 'white' | 'blue' | 'slate';
}

const Logo: React.FC<LogoProps> = ({ className = '', size = 40, variant = 'white' }) => {
  const colors = {
    white: '#FFFFFF',
    blue: '#3b82f6',
    slate: '#0f172a'
  };

  const color = colors[variant];

  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Abstract outer frame */}
      <rect x="10" y="10" width="80" height="80" rx="24" fill={color} fillOpacity="0.1" />
      
      {/* Main Brand Shape - Prism/Lens */}
      <path 
        d="M50 20L80 35V65L50 80L20 65V35L50 20Z" 
        stroke={color} 
        strokeWidth="8" 
        strokeLinejoin="round" 
      />
      
      {/* Inner Insight Line - Rising Trend */}
      <path 
        d="M35 60L45 50L55 55L65 40" 
        stroke={color} 
        strokeWidth="8" 
        strokeLinecap="round" 
        strokeLinejoin="round" 
      />
      
      {/* Central Core Point */}
      <circle cx="50" cy="50" r="4" fill={color} />
    </svg>
  );
};

export default Logo;
