# shellcheck shell=bash
# The per-session state file (skills#267) and the flat JSON it is made
# of. Sourced by state.sh, so every script that resolves the state also
# reads and writes it the same way.

# Print the string value a key carries in a one-object JSON text.
#   $1  key
#   $2  the JSON text: a hook input, a pid file or a state file
# Prints the value of the key's last occurrence on a line, with each
# backslash escape replaced by the character it escapes (\" by ", \\
# by \); nothing when the key is absent. Reads flat string values only.
# An escape that names no single character, \n or \u00e9, reads as
# its letter: the state writer never writes one.
# sed, not a JSON tool: the consumer may lack one.
handoff_json_field() {
    printf '%s\n' "$2" \
        | sed -n -E "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"(([^\"\\\\]|\\\\.)*)\".*/\1/p" \
        | sed -E 's/\\(.)/\1/g'
}

# Print the number, or null, a key carries in a one-object JSON text.
#   $1  key
#   $2  the JSON text
# Prints the digits or the word null; nothing when the key is absent or
# carries anything else.
handoff_json_number() {
    printf '%s\n' "$2" \
        | sed -n -E "s/.*\"$1\"[[:space:]]*:[[:space:]]*([0-9]+|null).*/\1/p"
}

# The fields of the per-session state, in the order the writer writes
# them. Numbers are written bare, everything else as a JSON string.
HANDOFF_STATE_STRINGS="written_at handoff_path published_url transcript_path phase draft_path"
HANDOFF_STATE_NUMBERS="written_epoch context_tokens"

# Print a value escaped for a JSON string: \ and " get a backslash.
#   $1  value, free of control characters
handoff_json_escape() {
    printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

# Set fields of a per-session state file, keeping the others.
#   $1     the state file; created with its directory when absent
#   $2...  pairs of field name and value; an empty value removes the
#          field
# The one writer of the state file (skills#267): it escapes every
# value and replaces the file with a rename, so a hook that reads the
# file at any moment sees the old content or the new, never half.
# Errors, exit status 1 with a message on stderr: a field name outside
# HANDOFF_STATE_STRINGS and HANDOFF_STATE_NUMBERS, a pair without a
# value, a number field holding anything but digits or null, a value
# with a control character.
handoff_state_set() {
    local file=$1 key value text="" json="" tmp
    shift
    [ -f "$file" ] && text=$(cat "$file")
    for key in $HANDOFF_STATE_STRINGS; do
        local "hs_$key"
        printf -v "hs_$key" '%s' "$(handoff_json_field "$key" "$text")"
    done
    for key in $HANDOFF_STATE_NUMBERS; do
        local "hs_$key"
        printf -v "hs_$key" '%s' "$(handoff_json_number "$key" "$text")"
    done
    while [ $# -gt 0 ]; do
        key=$1
        if [ $# -lt 2 ]; then
            echo "handoff_state_set: field $key has no value (file $file)" >&2
            return 1
        fi
        value=$2
        shift 2
        case " $HANDOFF_STATE_STRINGS $HANDOFF_STATE_NUMBERS " in
            *" $key "*) ;;
            *) echo "handoff_state_set: unknown field $key (file $file)" >&2
               return 1 ;;
        esac
        case "$value" in
            *[[:cntrl:]]*)
                echo "handoff_state_set: field $key holds a control character (file $file)" >&2
                return 1 ;;
        esac
        case " $HANDOFF_STATE_NUMBERS " in
            *" $key "*)
                case "$value" in
                    ''|null) ;;
                    *[!0-9]*) echo "handoff_state_set: field $key needs digits or null," \
                                   "got '$value' (file $file)" >&2
                              return 1 ;;
                esac ;;
        esac
        printf -v "hs_$key" '%s' "$value"
    done
    for key in $HANDOFF_STATE_STRINGS $HANDOFF_STATE_NUMBERS; do
        eval "value=\$hs_$key"
        [ -n "$value" ] || continue
        case " $HANDOFF_STATE_NUMBERS " in
            *" $key "*) json="$json,\"$key\":$value" ;;
            *) json="$json,\"$key\":\"$(handoff_json_escape "$value")\"" ;;
        esac
    done
    mkdir -p "$(dirname "$file")"
    tmp="$file.tmp.$$"
    printf '{%s}\n' "${json#,}" > "$tmp"
    mv -f "$tmp" "$file"
}
