import { useRef } from 'react'

export default function OtpInput({ digits, onChange, disabled }) {
  const inputs = useRef([])

  function enter(index, value) {
    const numbers = value.replace(/\D/g, '').slice(0, 6)
    if (!numbers) {
      onChange(digits.map((digit, position) => position === index ? '' : digit))
      return
    }
    const start = numbers.length === 6 ? 0 : index
    const next = [...digits]
    for (let offset = 0; offset < numbers.length && start + offset < 6; offset++) {
      next[start + offset] = numbers[offset]
    }
    onChange(next)
    inputs.current[Math.min(start + numbers.length, 5)]?.focus()
  }

  function keyDown(event, index) {
    if (event.key === 'Backspace') {
      event.preventDefault()
      const target = digits[index] || index === 0 ? index : index - 1
      onChange(digits.map((digit, position) => position === target ? '' : digit))
      inputs.current[target]?.focus()
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      inputs.current[Math.max(0, Math.min(5, index + (event.key === 'ArrowLeft' ? -1 : 1)))]?.focus()
    }
  }

  return (
    <div role="group" aria-label="Verification code" className="grid grid-cols-6 gap-2 sm:gap-3">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => { inputs.current[index] = element }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          pattern="[0-9]"
          required
          disabled={disabled}
          aria-label={`Digit ${index + 1}`}
          value={digit}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => enter(index, event.target.value)}
          onKeyDown={(event) => keyDown(event, index)}
          onPaste={(event) => { event.preventDefault(); enter(index, event.clipboardData.getData('text')) }}
          className="h-12 w-full min-w-0 rounded-lg border border-slate-300 bg-white text-center text-2xl font-bold text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60 sm:h-14"
        />
      ))}
    </div>
  )
}
