-- zorder.applescript <src.key>: for every shown slide with a movie, list its
-- items back to front: Z <n> <i> <class> <x> <y> <w> <h> <file>
on run argv
	set out to {}
	tell application "Keynote"
		with timeout of 3600 seconds
			set d to open (POSIX file (item 1 of argv))
		end timeout
		set n to 0
		repeat with s in slides of d
			if skipped of s is false then
				set n to n + 1
				if (count of movies of s) > 0 then
					set i to 0
					repeat with obj in iWork items of s
						set i to i + 1
						set c to (class of obj) as text
						set fn to ""
						try
							set fn to file name of obj
						end try
						set p to {0, 0}
						try
							set p to position of obj
						end try
						set w to 0
						set h to 0
						try
							set w to width of obj
							set h to height of obj
						end try
						set end of out to "Z" & tab & n & tab & i & tab & c & tab & (item 1 of p) & tab & (item 2 of p) & tab & w & tab & h & tab & fn
					end repeat
				end if
			end if
		end repeat
		close d saving no
	end tell
	set AppleScript's text item delimiters to linefeed
	return out as text
end run
