# Dedicated interactive prompt; never loads the server user's shell startup files.
__xt_prompt() {
  local result=$?
  __xt_directory=${PWD/#$HOME/\~}
  # Filenames may contain terminal control characters. Keep them out of the prompt.
  __xt_directory=${__xt_directory//[[:cntrl:]]/?}
  PS1='\[\e[38;5;110m\]${__xt_directory}\[\e[0m\]\$ '
  return "$result"
}
PROMPT_COMMAND=__xt_prompt
PS2='… '

# Color only when stdout is a terminal; redirected/piped output stays plain.
case "$OSTYPE" in
  darwin*) alias ls='ls -G' ;;
  *) alias ls='ls --color=auto' ;;
esac
