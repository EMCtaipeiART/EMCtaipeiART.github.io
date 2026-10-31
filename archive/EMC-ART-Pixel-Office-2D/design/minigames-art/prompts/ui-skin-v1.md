You are the pixel artist for a small office-themed mini-game that lives inside an existing pixel-art web app ("EMC Pixel Office"). The attached reference images are the EXISTING art. Study them and match their look exactly:
- crisp pixel art, hard edges, NO anti-aliasing, NO gradients, NO glow, NO blur, NO text or letters inside sprites (except the digits and "GO" in the countdown row),
- dark navy outline around every shape (about 3 logical pixels at final size in the references, here use 2 logical pixels),
- flat shading with only 2-3 tones per colour (base, one shade, one small highlight),
- cheerful, clean, "office" mood on a plain white background.

TASK: use your image generation tool to create ONE sprite sheet PNG and save it to ./raw/ui-skin-v1.png (create ./raw if needed). Do not modify any other file.

SHEET FORMAT (important, a script will slice it):
- Image size 1536 x 1024 px. Background: perfectly flat solid magenta #FF00FF everywhere (it will be keyed out). Never use magenta inside sprites.
- Draw at exactly 4x scale: every logical pixel is a clean 4x4 block, so downscaling by 4 with nearest-neighbour gives the final sprite.
- Grid: 8 columns x 5 rows, each cell 192 x 192 px (= 48 x 48 logical px). One sprite per cell, centred, at least 1 logical px of magenta margin to the cell edge. Rows read left to right, top to bottom. Leave the bottom 64 px of the image magenta.
- Palette (only these): navy #182e54, white #ffffff, pale blue #e8f0ff, light grey #c9d2e0, grey #8c98ad, blue #5b8def, yellow #ffd24a, orange #e8913a, red #d9534f, green #4caf6a. Dark shade variants of these are allowed (about 25% darker).

SPRITES (final logical size inside its cell; draw each as described):
Row 1 - buttons and plates (these will be 9-sliced, keep the middle area plain so it can stretch, keep corners identical):
 1. button_blue 40x28: pale-blue rounded-corner button, navy outline, 1px white highlight along the top, 3px darker-blue shade along the bottom.
 2. button_blue_pressed 40x28: same button pressed (no bottom shade, content 2px lower).
 3. button_yellow 40x28: the primary-action button in yellow with orange shade.
 4. button_red 40x28: danger/quit button in red with dark-red shade.
 5. panel_white 44x44: dialog panel, white fill, navy outline, small corner notches, 3px hard drop shadow bottom/right in light grey.
 6. panel_paper 44x44: same panel but pale-blue fill with a very faint grid.
 7. hud_plate 44x20: small pill-shaped HUD plate, white fill, navy outline.
 8. toast_plate 44x24: banner plate, navy fill with white 1px inner line.
Row 2 - icons, each 24x24 logical, navy outline + one or two fill colours:
 9. pause (two bars)  10. play (triangle)  11. close (X)  12. exit door with arrow  13. hint (light bulb, yellow)  14. catch hand (open palm, orange)  15. map (folded map, green/blue)  16. clock (white face)
Row 3 - icons 24x24 logical:
 17. star (yellow)  18. flame (orange/red, "combo")  19. wind arrow (blue)  20. trophy (yellow)  21. heart (red)  22. eye (white/blue)  23. ghost (pale, for "caught")  24. magnifier (blue handle)
Row 4 - rewards, drawn bigger:
 25. medal_gold 32x32 (round medal on a short ribbon)  26. medal_silver 32x32  27. medal_bronze 32x32  28. new_record burst 40x40 (yellow starburst with a small red banner, no text)  29. crown 28x20 (yellow)  30. sparkle 16x16 (white/yellow four-point star)  31. confetti 24x24 (a few coloured squares)  32. check badge 24x24 (green circle with white check)
Row 5 - controls:
 33. joystick_base 44x44 (ring, grey, navy outline)  34. joystick_knob 20x20 (navy ball with a highlight)  35. catch_button 44x44 (round red button, white outline, a white hand silhouette)  36. digit_3 24x32  37. digit_2 24x32  38. digit_1 24x32  39. digit_go 32x32 (the letters GO in a yellow starburst)  40. empty (leave this cell magenta)
The digits use a chunky pixel font: white fill with a thick navy outline.

After generating, verify the PNG exists at ./raw/ui-skin-v1.png and report its pixel size. Do not describe the image at length; just confirm the file.
