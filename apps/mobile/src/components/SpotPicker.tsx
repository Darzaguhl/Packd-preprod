import React, { useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import type { RoomLayout, SpotAssignment } from '../lib/api'
import { STATION_META } from '../lib/constants'

const MIN_STATION_PX = 44   // minimum tap target / readable size
const MIN_PX_PER_M   = 52   // minimum scale so labels stay readable

const MINI_W = 72           // minimap width in px

interface ScrollState {
  offsetX: number
  offsetY: number
  viewW: number
  viewH: number
  zoom: number
}

interface Props {
  layout: RoomLayout
  assignments: SpotAssignment[]
  myStationId: string | null
  onPick: (stationId: string | null) => void
}

export default function SpotPicker({ layout, assignments, myStationId, onPick }: Props) {
  const [containerWidth, setContainerWidth] = useState(0)
  const [scroll, setScroll] = useState<ScrollState>({ offsetX: 0, offsetY: 0, viewW: 0, viewH: 0, zoom: 1 })

  const takenMap = new Map(assignments.filter(a => a.stationId).map(a => [a.stationId!, a]))

  const scale   = containerWidth > 0 ? Math.max(containerWidth / layout.widthM, MIN_PX_PER_M) : MIN_PX_PER_M
  const mapW    = Math.ceil(layout.widthM  * scale)
  const mapH    = Math.ceil(layout.lengthM * scale)

  // Minimap dimensions and viewport rectangle
  const miniH     = Math.round(MINI_W * layout.lengthM / layout.widthM)
  const miniScale = MINI_W / layout.widthM

  // Visible area in unzoomed content coords
  const visibleW = scroll.zoom > 0 ? scroll.viewW / scroll.zoom : scroll.viewW
  const visibleH = scroll.zoom > 0 ? scroll.viewH / scroll.zoom : scroll.viewH
  const vpX   = Math.max(0, Math.min(scroll.offsetX / scale, layout.widthM  - visibleW / scale)) * miniScale
  const vpY   = Math.max(0, Math.min(scroll.offsetY / scale, layout.lengthM - visibleH / scale)) * miniScale
  const vpW   = Math.min(visibleW / scale * miniScale, MINI_W)
  const vpH   = Math.min(visibleH / scale * miniScale, miniH)

  const isScrolled = scroll.offsetX > 4 || scroll.offsetY > 4 || scroll.zoom !== 1

  return (
    <View
      onLayout={e => setContainerWidth(e.nativeEvent.layout.width)}
      style={styles.wrapper}
    >
      {containerWidth > 0 && (
        <View style={{ position: 'relative' }}>
          <ScrollView
            horizontal
            maximumZoomScale={4}
            minimumZoomScale={0.4}
            bouncesZoom
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={e => {
              const n = e.nativeEvent
              setScroll({
                offsetX: n.contentOffset.x,
                offsetY: n.contentOffset.y,
                viewW: n.layoutMeasurement.width,
                viewH: n.layoutMeasurement.height,
                zoom: (n as any).zoomScale ?? 1,
              })
            }}
            style={{ maxHeight: Math.min(mapH + 2, 380), borderRadius: 12 }}
            contentContainerStyle={{ width: mapW, height: mapH }}
          >
            <View style={[styles.room, { width: mapW, height: mapH }]}>
              {layout.stations.map(station => {
                const meta     = STATION_META[station.type] ?? STATION_META.OTHER
                const occupant = takenMap.get(station.id)
                const isMine   = station.id === myStationId
                const isTaken  = !!occupant && !isMine

                const left   = station.xM * scale
                const top    = station.yM  * scale
                const width  = Math.max(MIN_STATION_PX, meta.wM * scale)
                const height = Math.max(MIN_STATION_PX, meta.hM * scale)

                // "Treadmill 1" → "T1", "Bike 3" → "B3"; custom short labels pass through
                const raw = station.label?.trim() || ''
                const num = raw.match(/\d+/)
                const displayLabel = raw ? `${meta.short}${num ? num[0] : ''}` : meta.short

                return (
                  <Pressable
                    key={station.id}
                    disabled={isTaken}
                    onPress={() => onPick(isMine ? null : station.id)}
                    style={({ pressed }) => ({
                      position: 'absolute',
                      left, top, width, height,
                      borderRadius: 8,
                      borderWidth: 2,
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 1,
                      borderColor: isMine ? '#4338ca' : isTaken ? '#d1d5db' : '#6ee7b7',
                      backgroundColor: isMine ? '#4f46e5'
                        : isTaken ? '#e5e7eb'
                        : pressed ? '#6ee7b7'
                        : '#ecfdf5',
                      opacity: isTaken ? 0.6 : 1,
                    })}
                  >
                    {isMine ? (
                      <>
                        <Text style={styles.labelMine}>✓</Text>
                        <Text style={styles.labelMineSmall}>You</Text>
                      </>
                    ) : isTaken ? (
                      <Text
                        style={[styles.label, { color: '#9ca3af' }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.75}
                      >
                        Taken
                      </Text>
                    ) : (
                      <Text
                        style={[styles.label, { color: '#065f46' }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.75}
                      >
                        {displayLabel}
                      </Text>
                    )}
                  </Pressable>
                )
              })}
            </View>
          </ScrollView>

          {/* Minimap — shows current viewport position, visible whenever scrolled or zoomed */}
          {isScrolled && (
            <View style={[styles.minimap, { width: MINI_W, height: miniH }]}>
              {/* Station dots */}
              {layout.stations.map(station => {
                const isMine   = station.id === myStationId
                const isTakenM = !!takenMap.get(station.id) && !isMine
                return (
                  <View
                    key={station.id}
                    style={{
                      position: 'absolute',
                      left:   station.xM * miniScale,
                      top:    station.yM  * miniScale,
                      width:  Math.max(4, (STATION_META[station.type] ?? STATION_META.OTHER).wM * miniScale),
                      height: Math.max(3, (STATION_META[station.type] ?? STATION_META.OTHER).hM * miniScale),
                      borderRadius: 2,
                      backgroundColor: isMine ? '#4f46e5' : isTakenM ? '#d1d5db' : '#6ee7b7',
                      opacity: 0.7,
                    }}
                  />
                )
              })}
              {/* Viewport rectangle */}
              <View
                style={{
                  position: 'absolute',
                  left: vpX, top: vpY,
                  width: Math.max(vpW, 6), height: Math.max(vpH, 4),
                  borderWidth: 1.5,
                  borderColor: '#111827',
                  backgroundColor: 'rgba(17,24,39,0.12)',
                  borderRadius: 3,
                }}
              />
            </View>
          )}
        </View>
      )}

      <Text style={styles.zoomHint}>Pinch to zoom · scroll to pan</Text>
    </View>
  )
}


const styles = StyleSheet.create({
  wrapper: { width: '100%' },
  room: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    overflow: 'hidden',
    position: 'relative',
  },
  label: {
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  labelMine: { fontSize: 15, fontWeight: '800', color: '#fff' },
  labelMineSmall: { fontSize: 10, fontWeight: '600', color: '#d1d5db' },
  minimap: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    overflow: 'hidden',
  },
  zoomHint: {
    fontSize: 10,
    color: '#d1d5db',
    textAlign: 'center',
    marginTop: 5,
  },
})
