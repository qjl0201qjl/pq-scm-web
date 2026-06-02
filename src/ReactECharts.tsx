import { CSSProperties, useEffect, useRef } from 'react';
import * as echarts from 'echarts';

interface ReactEChartsProps {
  option: echarts.EChartsOption;
  className?: string;
  style?: CSSProperties;
  onEvents?: Record<string, (params: any) => void>;
}

export default function ReactECharts({ option, className, style, onEvents }: ReactEChartsProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    chartRef.current = echarts.init(ref.current, 'dark');
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onEvents) return;
    Object.entries(onEvents).forEach(([eventName, handler]) => chart.on(eventName, handler));
    return () => {
      Object.entries(onEvents).forEach(([eventName, handler]) => chart.off(eventName, handler));
    };
  }, [onEvents]);

  useEffect(() => {
    const handleResize = () => chartRef.current?.resize();
    window.addEventListener('resize', handleResize);
    const timer = window.setTimeout(handleResize, 80);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.clearTimeout(timer);
    };
  }, []);

  return <div ref={ref} className={className} style={style} />;
}
