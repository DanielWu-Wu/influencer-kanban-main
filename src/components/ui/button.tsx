import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium tracking-[-0.005em] transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-[180ms] ease-out active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:hover:shadow-none disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/35 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: 'border border-primary/20 bg-primary text-primary-foreground shadow-[0_6px_16px_rgba(24,119,242,0.18),inset_0_1px_0_rgba(255,255,255,0.22)] hover:bg-primary/94 hover:shadow-[0_8px_20px_rgba(24,119,242,0.22),inset_0_1px_0_rgba(255,255,255,0.25)]',
        destructive:
          'bg-destructive text-white shadow-sm hover:bg-destructive/90 hover:shadow-md focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline:
          'glass-control border-border/70 bg-white/72 text-foreground shadow-none hover:border-primary/25 hover:bg-white/92 hover:text-accent-foreground hover:shadow-sm dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
        secondary:
          'border border-border/50 bg-secondary/78 text-secondary-foreground shadow-none hover:bg-secondary hover:shadow-sm',
        ghost:
          'hover:bg-white/72 hover:text-accent-foreground hover:shadow-sm dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:text-primary/80 hover:underline active:scale-100',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
