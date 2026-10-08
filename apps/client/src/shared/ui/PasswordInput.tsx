import { useState, type ComponentProps } from 'react'
import { Eye, EyeOff } from 'lucide-react'

type PasswordInputProps = Omit<ComponentProps<'input'>, 'type'>

/**
 * Campo de senha com botão de mostrar/ocultar (olhinho).
 * Repassa as props do <input>; o consumidor controla o visual via `className`
 * (use `pr-10` para reservar espaço do ícone). Sem `useEffect` — só `useState`.
 */
export function PasswordInput({ className = '', ...props }: PasswordInputProps) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input {...props} type={show ? 'text' : 'password'} className={`w-full ${className}`} />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
        aria-pressed={show}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
      >
        {show ? (
          <EyeOff className="size-4" aria-hidden="true" />
        ) : (
          <Eye className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  )
}
