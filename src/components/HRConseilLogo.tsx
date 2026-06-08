import React from "react";

interface HRConseilLogoProps {
  className?: string;
  size?: number;
}

export const HRConseilLogo: React.FC<HRConseilLogoProps> = ({ 
  className = "", 
  size = 48 
}) => {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 200 220" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={`${className} overflow-visible`}
      referrerPolicy="no-referrer"
    >
      {/* Trunk (Tronc) - Color #004F71 */}
      <path
        d="M93.3 194.2 C94.5 160 95.8 120 95.8 110 C92.5 110 88 120 80.5 125 C75 128.5 70.8 124 74 118 C83.2 101.2 92.5 98.4 97 97.4 C97 90.5 95 72.4 94 62 C95.5 62 101.5 62.5 104.5 72 C107.5 81.5 107.2 97.4 107.2 97.4 C112.5 95.4 125.8 85.5 130 79 C133 74 135 77 131 82 C125 90 114.5 104 107.2 108.5 C107.2 120 109 155 111.4 194.2 C111.4 195.5 93.3 196.5 93.3 194.2 Z"
        fill="#004F71"
      />

      {/* LEAVES (Feuilles) */}
      {/* 1. Navy Leaves (Feuilles Bleues) - Color #004F71 */}
      {/* Bottom Left Leaf */}
      <path
        d="M32 125 C40 120 54 119 55 128 C55 137 40 135 32 125 Z"
        fill="#004F71"
      />
      {/* Upper Left Leaf */}
      <path
        d="M48 64 C42 48 55 38 64 45 C73 52 57 68 48 64 Z"
        fill="#004F71"
      />
      {/* Top Right Inner Leaf */}
      <path
        d="M104 60 C110 46 126 44 126 53 C124 68 111 68 104 60 Z"
        fill="#004F71"
      />
      {/* Far Right Top Leaf */}
      <path
        d="M136 34 C132 23 145 18 152 23 C154 34 142 41 136 34 Z"
        fill="#004F71"
      />

      {/* 2. Green Leaves (Feuilles Vertes) - Color #6DB326 */}
      {/* Left Canopy Outer Leaves */}
      <path
        d="M19 92 C15 78 28 73 35 80 C40 88 28 99 19 92 Z"
        fill="#6DB326"
      />
      <path
        d="M43 93 C41 80 54 75 60 84 C66 93 50 102 43 93 Z"
        fill="#6DB326"
      />
      <path
        d="M31 150 C29 135 44 135 48 143 C50 155 38 160 31 150 Z"
        fill="#6DB326"
      />
      <path
        d="M51 135 C52 121 68 122 71 130 C74 140 59 146 51 135 Z"
        fill="#6DB326"
      />
      
      {/* Top Left Canopy Leaves */}
      <path
        d="M62 30 C72 20 86 31 82 40 C78 48 62 44 62 30 Z"
        fill="#6DB326"
      />
      <path
        d="M82 48 C85 35 98 33 102 44 C104 53 87 58 82 48 Z"
        fill="#6DB326"
      />
      <path
        d="M75 106 C74 95 86 91 91 98 C95 105 82 114 75 106 Z"
        fill="#6DB326"
      />
      <path
        d="M82 85 C83 72 95 72 96 81 C96 90 84 94 82 85 Z"
        fill="#6DB326"
      />
      <path
        d="M102 24 C102 11 118 10 118 20 C116 32 105 32 102 24 Z"
        fill="#6DB326"
      />

      {/* Top Right & Right Canopy Leaves */}
      <path
        d="M141 53 C145 42 161 46 158 55 C154 66 142 61 141 53 Z"
        fill="#6DB326"
      />
      <path
        d="M118 84 C120 73 134 76 132 85 C130 94 119 92 118 84 Z"
        fill="#6DB326"
      />
      <path
        d="M125 101 C133 93 147 99 144 108 C139 119 127 111 125 101 Z"
        fill="#6DB326"
      />
      <path
        d="M142 81 C153 77 163 88 155 96 C147 103 139 90 142 81 Z"
        fill="#6DB326"
      />
      <path
        d="M152 111 C161 104 174 113 170 122 C165 132 153 121 152 111 Z"
        fill="#6DB326"
      />
      <path
        d="M140 126 C143 115 156 120 154 128 C152 136 140 134 140 126 Z"
        fill="#6DB326"
      />
      
      {/* Bottom Right Canopy Leaves */}
      <path
        d="M114 110 C120 119 112 133 105 125 C99 118 107 105 114 110 Z"
        fill="#6DB326"
      />
      <path
        d="M118 141 C121 152 108 164 102 154 C98 144 112 132 118 141 Z"
        fill="#6DB326"
      />
      <path
        d="M124 125 C133 120 144 131 138 140 C132 148 122 136 124 125 Z"
        fill="#6DB326"
      />
    </svg>
  );
};
