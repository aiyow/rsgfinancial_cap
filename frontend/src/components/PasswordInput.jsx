import { useEffect, useId, useRef, useState } from 'react'
import { Check, Eye, EyeOff, X } from 'lucide-react'
import { passwordError, passwordRequirements } from '../utils/passwordPolicy'

export default function PasswordInput({
  label, value, onChange, current = false, confirmationFor,
  required = true, disabled = false,
  inputClassName = 'mt-1.5 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 font-normal outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--active-bg)]',
  labelClassName = 'block text-sm font-semibold text-[var(--ink)]',
}) {
  const id = useId()
  const input = useRef(null)
  const [visible, setVisible] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hasTyped, setHasTyped] = useState(false)
  const confirming = confirmationFor !== undefined
  const issue = !value || current ? '' : confirming
    ? (value !== confirmationFor ? 'Password and confirmation do not match.' : '')
    : passwordError(value)
  const requirements = passwordRequirements(value)
  const completed = requirements.filter(requirement => requirement.passed).length
  const showFeedback = Boolean(value) || (focused && hasTyped)
  const showHelp = !current && !confirming && showFeedback

  useEffect(() => {
    input.current?.setCustomValidity(disabled ? '' : issue)
  }, [disabled, issue])

  return <div className="min-w-0">
    <label htmlFor={id} className={labelClassName}>{label}</label>
    <div className="relative">
      <input ref={input} id={id} required={required} disabled={disabled}
        type={visible ? 'text' : 'password'} autoComplete={current ? 'current-password' : 'new-password'}
        maxLength={current ? 256 : undefined} value={value}
        onChange={event => { setHasTyped(true); onChange(event) }}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        aria-invalid={Boolean(value && issue)} aria-describedby={!current && showFeedback ? `${id}-help` : undefined}
        className={`${inputClassName} pr-11 disabled:bg-slate-100 disabled:text-slate-400`} />
      <button type="button" disabled={disabled} onClick={() => setVisible(previous => !previous)}
        aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
        className="absolute inset-y-0 right-0 mt-1.5 grid w-11 place-items-center rounded-lg text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-40">
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
    {showHelp && <div id={`${id}-help`} className="password-feedback-reveal text-xs leading-5">
      <div className="min-h-0 overflow-hidden">
        <div className="mt-2.5 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="font-semibold text-[var(--ink)]">Password requirements</p>
            <p aria-live="polite" aria-atomic="true" className="text-[var(--muted)]">{completed} of {requirements.length} met</p>
          </div>
          <ul aria-label="Password requirements" className="space-y-1.5">
            {requirements.map(requirement => <RequirementItem key={requirement.code} {...requirement} />)}
          </ul>
        </div>
      </div>
    </div>}
    {confirming && showFeedback && <div id={`${id}-help`} className="password-feedback-reveal text-xs leading-5">
      <div className="min-h-0 overflow-hidden">
        <ul aria-label="Password confirmation" aria-live="polite" className="mt-2">
          <RequirementItem code="confirmation" label="Passwords match" passed={Boolean(value) && value === confirmationFor} />
        </ul>
      </div>
    </div>}

  </div>
}

function RequirementItem({ code, label, passed }) {
  const iconTransition = 'absolute inset-0 m-auto transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none'
  return <li data-requirement={code} data-satisfied={passed} className={`flex items-start gap-2 transition-colors duration-200 motion-reduce:transition-none ${passed ? 'text-emerald-700' : 'text-red-700'}`}>
    <span aria-hidden="true" className={`relative mt-0.5 size-4 shrink-0 rounded-full border transition-colors duration-200 motion-reduce:transition-none ${passed ? 'border-emerald-200 bg-emerald-100' : 'border-red-200 bg-red-100'}`}>
      <Check size={11} strokeWidth={3} className={`${iconTransition} ${passed ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`} />
      <X size={10} strokeWidth={2.5} className={`${iconTransition} ${passed ? 'scale-50 opacity-0' : 'scale-100 opacity-100'}`} />
    </span>
    <span><span className="sr-only">{passed ? 'Met: ' : 'Not met: '}</span>{label}</span>
  </li>
}
