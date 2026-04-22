interface MicButtonProps {
  isMuted: boolean;
  disabled: boolean;
  onToggle: () => void;
}

export function MicButton({ isMuted, disabled, onToggle }: MicButtonProps) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`
        relative flex h-14 w-14 items-center justify-center rounded-full
        transition-all duration-200 shadow-lg
        ${
          disabled
            ? "bg-gray-200 text-gray-400 cursor-not-allowed"
            : isMuted
              ? "bg-red-100 text-red-500 hover:bg-red-200 hover:shadow-red-200"
              : "bg-blue-100 text-blue-600 hover:bg-blue-200 hover:shadow-blue-200"
        }
      `}
      title={isMuted ? "Unmute microphone" : "Mute microphone"}
    >
      {isMuted ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
          />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
          />
        </svg>
      )}

      {!isMuted && !disabled && (
        <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
        </span>
      )}
    </button>
  );
}
