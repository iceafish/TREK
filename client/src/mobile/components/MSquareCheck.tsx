import { Check } from 'lucide-react'

/** 17px (panel) / 19px (row) square checkbox in the demo's act-fill style. */
export default function MSquareCheck({ checked, big = false }: { checked: boolean; big?: boolean }) {
  return (
    <span
      className={`flex flex-none items-center justify-center border-[1.5px] ${
        big ? 'h-[19px] w-[19px] rounded-[6px]' : 'h-[17px] w-[17px] rounded-[5px]'
      } ${checked ? 'border-[color:var(--m-act)] bg-m-act text-m-actfg' : 'border-[color:var(--m-trackoff)] text-transparent'}`}
    >
      <Check size={big ? 12 : 11} strokeWidth={3} />
    </span>
  )
}
