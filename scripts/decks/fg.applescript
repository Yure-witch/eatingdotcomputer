-- fg.applescript <copy.key> <outdir> <spec>: spec "44:5,6;45:4" = shown slide : item indexes.
-- Deletes those items on those slides, skips every other slide, exports PNGs.
on run argv
	set AppleScript's text item delimiters to ";"
	set specs to text items of (item 3 of argv)
	set targets to {}
	set dels to {}
	repeat with sp in specs
		set AppleScript's text item delimiters to ":"
		set parts to text items of sp
		set end of targets to (item 1 of parts) as integer
		set AppleScript's text item delimiters to ","
		set end of dels to text items of (item 2 of parts)
	end repeat
	tell application "Keynote"
		with timeout of 3600 seconds
			set d to open (POSIX file (item 1 of argv))
		end timeout
		set shown to {}
		repeat with s in slides of d
			if skipped of s is false then set end of shown to contents of s
		end repeat
		repeat with k from 1 to count of shown
			set s to item k of shown
			set t to 0
			repeat with j from 1 to count of targets
				if item j of targets is k then set t to j
			end repeat
			if t is 0 then
				set skipped of s to true
			else
				set idx to item t of dels
				-- delete from the front-most down so indexes stay valid
				repeat with q from (count of idx) to 1 by -1
					delete iWork item ((item q of idx) as integer) of s
				end repeat
			end if
		end repeat
		with timeout of 3600 seconds
			export d to POSIX file (item 2 of argv) as slide images with properties {image format:PNG, skipped slides:false, all stages:false}
		end timeout
		close d saving no
	end tell
end run
